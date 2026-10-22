import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFetch, AUTH_SESSION_EXPIRED_EVENT, userApiUrl } from "../src/api/client.ts";
import { readCurrentUser } from "../src/auth/session-check.ts";
import { serviceResponseError, serviceUnavailable } from "../src/api/service-errors.ts";

function useFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}

function useWindow(t) {
  const original = globalThis.window;
  const events = new EventTarget();
  globalThis.window = events;
  t.after(() => {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  });
  return events;
}

test("a direct gateway outage does not revoke the in-memory session", async (t) => {
  const events = useWindow(t);
  let expired = 0;
  events.addEventListener(AUTH_SESSION_EXPIRED_EVENT, () => expired++);
  let requests = 0;
  useFetch(t, async () => {
    requests++;
    return new Response("Bad Gateway", { status: 502 });
  });

  const response = await apiFetch(userApiUrl("/auth/me"));
  assert.equal(response.status, 502);
  assert.equal(requests, 1);
  assert.equal(expired, 0);
  await assert.rejects(readCurrentUser(response), /unavailable/);
});

test("refresh outage remains unavailable rather than dispatching logout", async (t) => {
  const events = useWindow(t);
  let expired = 0;
  events.addEventListener(AUTH_SESSION_EXPIRED_EVENT, () => expired++);
  const paths = [];
  useFetch(t, async (path) => {
    paths.push(path);
    if (path === userApiUrl("/auth/refresh")) return new Response("Bad Gateway", { status: 502 });
    return Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  });

  const response = await apiFetch("/api/supplier/suppliers");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "AUTHORIZATION_UNAVAILABLE");
  assert.deepEqual(paths, ["/api/supplier/suppliers", userApiUrl("/auth/refresh")]);
  assert.equal(expired, 0);
});

test("confirmed invalid refresh dispatches logout", async (t) => {
  const events = useWindow(t);
  let expired = 0;
  events.addEventListener(AUTH_SESSION_EXPIRED_EVENT, () => expired++);
  useFetch(t, async (path) => path === userApiUrl("/auth/refresh")
    ? Response.json({ code: "REFRESH_SESSION_INVALID" }, { status: 401 })
    : Response.json({ code: "ACCESS_TOKEN_EXPIRED" }, { status: 401 }));

  const response = await apiFetch("/api/order/errands");
  assert.equal(response.status, 401);
  assert.equal(expired, 1);
});

test("successful refresh retries the original request exactly once", async (t) => {
  const events = useWindow(t);
  let expired = 0;
  events.addEventListener(AUTH_SESSION_EXPIRED_EVENT, () => expired++);
  let orderRequests = 0;
  useFetch(t, async (path) => {
    if (path === userApiUrl("/auth/refresh")) return Response.json({ user: { id: "u1" } });
    orderRequests++;
    return orderRequests === 1
      ? Response.json({ code: "ACCESS_TOKEN_EXPIRED" }, { status: 401 })
      : Response.json({ errands: [] });
  });

  const response = await apiFetch("/api/order/errands");
  assert.equal(response.status, 200);
  assert.equal(orderRequests, 2);
  assert.equal(expired, 0);
});

test("session check distinguishes invalid, verified, and unavailable responses", async () => {
  const user = { id: "u1", username: "alice", email: "e1234567@u.nus.edu", accountType: "USER" };
  assert.deepEqual(await readCurrentUser(Response.json({ user })), user);
  assert.equal(await readCurrentUser(new Response(null, { status: 401 })), null);
  await assert.rejects(readCurrentUser(new Response("gateway", { status: 503 })), /unavailable/);
  await assert.rejects(readCurrentUser(Response.json({})), /invalid response/);
});

test("service errors hide gateway codes while preserving validation messages", async () => {
  assert.equal(await serviceResponseError(new Response("<html>502</html>", { status: 502 }), "Supplier Service", "fallback"), serviceUnavailable("Supplier Service"));
  assert.equal(await serviceResponseError(Response.json({ error: "This username is already taken." }, { status: 409 }), "User Service", "fallback"), "This username is already taken.");
});
