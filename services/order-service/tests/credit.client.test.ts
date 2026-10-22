import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { releaseReservation, reserveCredits, type CreditInput } from "../src/clients/credit.client.js";
import { CreditRecoveryRequiredError, InsufficientCreditsError, UpstreamError } from "../src/errors/order.errors.js";

const input: CreditInput = {
  orderId: "507f1f77bcf86cd799439011",
  requesterId: "507f1f77bcf86cd799439012",
  amount: 20,
};

function configure(t: TestContext) {
  const oldKey = process.env.ORDER_CREDIT_API_KEY;
  const oldUrl = process.env.CREDIT_SERVICE_URL;
  process.env.ORDER_CREDIT_API_KEY = "test-order-key";
  process.env.CREDIT_SERVICE_URL = "http://credit-service:3004";
  t.after(() => {
    if (oldKey === undefined) delete process.env.ORDER_CREDIT_API_KEY;
    else process.env.ORDER_CREDIT_API_KEY = oldKey;
    if (oldUrl === undefined) delete process.env.CREDIT_SERVICE_URL;
    else process.env.CREDIT_SERVICE_URL = oldUrl;
  });
}

test("a lost reserve response is accepted only when Credit confirms the same operation", async (t) => {
  configure(t);
  const call = t.mock.method(globalThis, "fetch", (async (url: URL | string, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-order-key");
    if (url.toString().endsWith("/credit/reservations")) throw new TypeError("response lost");
    return Response.json({ state: "RESERVED", requesterId: input.requesterId, amount: input.amount });
  }) as never);
  await reserveCredits(input);
  assert.equal(call.mock.callCount(), 2);
});

test("a confirmed absent reservation is retried once with the same orderId", async (t) => {
  configure(t);
  const ids: string[] = [];
  const call = t.mock.method(globalThis, "fetch", (async (url: URL | string, init?: RequestInit) => {
    if (url.toString().endsWith("/credit/reservations")) {
      ids.push((JSON.parse(init?.body as string) as CreditInput).orderId);
      if (ids.length === 1) throw new TypeError("first request lost");
      return Response.json({ applied: true });
    }
    return Response.json({ state: "NOT_RESERVED" });
  }) as never);
  await reserveCredits(input);
  assert.deepEqual(ids, [input.orderId, input.orderId]);
  assert.equal(call.mock.callCount(), 3);
});

test("mismatched Credit status cannot authorize Errand creation", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", (async (url: URL | string) =>
    url.toString().endsWith("/credit/reservations")
      ? new Response(null, { status: 503 })
      : Response.json({ state: "RESERVED", requesterId: "another-user", amount: input.amount })) as never);
  await assert.rejects(reserveCredits(input), CreditRecoveryRequiredError);
});

test("a rejected reserve with confirmed no operation remains an insufficient-credit error", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", (async (url: URL | string) =>
    url.toString().endsWith("/credit/reservations")
      ? Response.json({ error: "Requester account cannot cover" }, { status: 409 })
      : Response.json({ state: "NOT_RESERVED" })) as never);
  await assert.rejects(reserveCredits(input), InsufficientCreditsError);
});

test("an unavailable Credit status keeps the reserve outcome unknown", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", (async () => { throw new TypeError("network down"); }) as never);
  await assert.rejects(reserveCredits(input), UpstreamError);
});

test("a lost release response is accepted when Credit confirms a matching refund", async (t) => {
  configure(t);
  const call = t.mock.method(globalThis, "fetch", (async (url: URL | string) => {
    if (url.toString().endsWith("/release")) throw new TypeError("response lost");
    return Response.json({ state: "REFUNDED", requesterId: input.requesterId, amount: input.amount });
  }) as never);
  await releaseReservation(input);
  assert.equal(call.mock.callCount(), 2);
});

test("a prior transfer blocks release compensation", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", (async (url: URL | string) =>
    url.toString().endsWith("/release")
      ? Response.json({ error: "conflict" }, { status: 409 })
      : Response.json({ state: "TRANSFERRED", requesterId: input.requesterId, amount: input.amount })) as never);
  await assert.rejects(releaseReservation(input), CreditRecoveryRequiredError);
});
