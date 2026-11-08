import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { SignJWT } from "jose";
import { createApp } from "../src/app.js";
import { authorizationStore } from "../src/security/authorization-state.js";
import { LiveHub } from "../src/services/live-hub.js";
import { InMemoryNotificationStore, InMemorySubscriptionStore, nextId, sub } from "./fakes.js";

process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
const ALICE = "a1".repeat(12), BOB = "b2".repeat(12);

const token = (userId: string) =>
  new SignJWT({ role: "USER", authzVersion: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("5m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
const auth = async (userId = ALICE) => ({ Cookie: `access_token=${await token(userId)}`, "Content-Type": "application/json" });

let server: Server, base: string, notifications: InMemoryNotificationStore, subscriptions: InMemorySubscriptionStore, hub: LiveHub, pushEnabled = true;

async function seed(userId: string, title = "t") {
  return notifications.insertIfAbsent({
    userId, eventId: `${nextId()}:status:ACCEPTED`, errandId: "e".repeat(24), kind: "ERRAND_ACCEPTED", title, body: "b", url: "/u",
    recipientRole: "REQUESTER", urgency: "normal", actions: [], occurredAt: new Date(),
  });
}

before(async () => {
  authorizationStore.check = async () => "allowed";
  notifications = new InMemoryNotificationStore(); subscriptions = new InMemorySubscriptionStore(); hub = new LiveHub();
  const app = createApp({ notifications, subscriptions, hub, get pushEnabled() { return pushEnabled; } } as never);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/notifications`;
});
after(() => { hub.closeAll(); server.closeAllConnections(); server.close(); });
beforeEach(() => { notifications.rows = []; subscriptions.subs = []; pushEnabled = true; });

const post = async (path: string, body: unknown, userId = ALICE) =>
  fetch(`${base}${path}`, { method: "POST", headers: await auth(userId), body: JSON.stringify(body) });

describe("authentication", () => {
  test("every route except the public key requires a valid token", async () => {
    for (const [m, p] of [["GET", ""], ["GET", "/unread-count"], ["GET", "/stream"], ["POST", "/read"], ["POST", "/subscriptions"], ["POST", "/subscriptions/unsubscribe"]]) {
      const res = await fetch(`${base}${p}`, { method: m });
      assert.equal(res.status, 401, `${m} ${p}`);
      assert.equal((await res.json()).code, "AUTHENTICATION_REQUIRED");
    }
  });

  test("a revoked account is refused", async () => {
    const orig = authorizationStore.check; authorizationStore.check = async () => "revoked";
    try { assert.equal((await fetch(`${base}/unread-count`, { headers: await auth() })).status, 401); }
    finally { authorizationStore.check = orig; }
  });

  test("the VAPID public key is public, and 503 when push is off", async () => {
    process.env.VAPID_PUBLIC_KEY = "PUBKEY";
    const ok = await fetch(`${base}/vapid-public-key`);
    assert.deepEqual([ok.status, await ok.json()], [200, { publicKey: "PUBKEY" }]);
    pushEnabled = false;
    assert.equal((await fetch(`${base}/vapid-public-key`)).status, 503);
  });
});

describe("inbox", () => {
  test("lists only the caller's notifications, newest first, with a cursor", async () => {
    await seed(ALICE, "first"); await seed(BOB, "bobs"); const last = await seed(ALICE, "second");
    const body = await (await fetch(`${base}`, { headers: await auth() })).json();
    assert.deepEqual(body.items.map((i: any) => i.title), ["second", "first"]);
    assert.equal(body.nextCursor, body.items[1].id);
    const page2 = await (await fetch(`${base}?before=${last.id}&limit=1`, { headers: await auth() })).json();
    assert.deepEqual(page2.items.map((i: any) => i.title), ["first"]);
  });

  test("ignores a malformed cursor and clamps absurd limits", async () => {
    await seed(ALICE);
    const res = await fetch(`${base}?before=not-an-id&limit=99999`, { headers: await auth() });
    assert.equal(res.status, 200);
  });

  test("unread count, mark some read, mark all read", async () => {
    const a = await seed(ALICE), b = await seed(ALICE); await seed(ALICE);
    const count = async () => (await (await fetch(`${base}/unread-count`, { headers: await auth() })).json()).unread;
    assert.equal(await count(), 3);
    assert.deepEqual(await (await post("/read", { ids: [a.id, b.id] })).json(), { updated: 2, unread: 1 });
    assert.deepEqual(await (await post("/read", { all: true })).json(), { updated: 1, unread: 0 });
  });

  test("cannot mark someone else's notifications read", async () => {
    const bobs = await seed(BOB);
    assert.equal((await (await post("/read", { ids: [bobs.id] })).json()).updated, 0);
    assert.equal(await notifications.unreadCount(BOB), 1);
  });

  test("validates the read request", async () => {
    for (const body of [{}, { ids: [] }, { ids: ["x"] }, { ids: "abc" }, { ids: Array(101).fill(nextId()) }]) {
      const res = await post("/read", body);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, "VALIDATION_FAILED");
    }
  });
});

describe("push subscriptions", () => {
  const body = (over: Record<string, unknown> = {}) => ({ subscription: { endpoint: sub(ALICE).endpoint, keys: sub(ALICE).keys, expirationTime: null, ...over } });

  test("registers a browser", async () => {
    const res = await post("/subscriptions", body());
    assert.equal(res.status, 201);
    assert.equal(subscriptions.subs[0].userId, ALICE);
  });

  test("REJECTS endpoints pointing anywhere but a push service (SSRF)", async () => {
    for (const endpoint of ["http://credit-service:3004/credit/reservations", "https://169.254.169.254/x", "https://example.com/x"]) {
      const res = await post("/subscriptions", body({ endpoint }));
      assert.equal(res.status, 400, endpoint);
      assert.equal((await res.json()).code, "INVALID_SUBSCRIPTION");
    }
    assert.equal(subscriptions.subs.length, 0);
  });

  test("rejects bad keys and a missing subscription", async () => {
    assert.equal((await post("/subscriptions", body({ keys: { p256dh: "x", auth: "y" } }))).status, 400);
    assert.equal((await post("/subscriptions", {})).status, 400);
  });

  test("a second account on the same browser takes the subscription over", async () => {
    await post("/subscriptions", body());
    await post("/subscriptions", body(), BOB);
    assert.equal(subscriptions.subs.length, 1);
    assert.equal(subscriptions.subs[0].userId, BOB);
  });

  test("unsubscribe removes only the caller's own subscription", async () => {
    await post("/subscriptions", body());
    assert.deepEqual(await (await post("/subscriptions/unsubscribe", { endpoint: sub(ALICE).endpoint }, BOB)).json(), { removed: false });
    assert.equal(subscriptions.subs.length, 1);
    assert.deepEqual(await (await post("/subscriptions/unsubscribe", { endpoint: sub(ALICE).endpoint })).json(), { removed: true });
  });

  test("503 when push is not configured", async () => {
    pushEnabled = false;
    assert.equal((await post("/subscriptions", body())).status, 503);
  });
});

describe("GET /stream (SSE)", () => {
  async function readUntil(res: Response, needle: string, ms = 1500) {
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let text = "";
    const deadline = Date.now() + ms;
    while (!text.includes(needle) && Date.now() < deadline) {
      const r = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), 200))]);
      if (r && !r.done) text += dec.decode(r.value);
      if (r?.done) break;
    }
    await reader.cancel();
    return text;
  }

  test("streams live notifications for the caller only", async () => {
    const ctl = new AbortController();
    const res = await fetch(`${base}/stream`, { headers: await auth(), signal: ctl.signal });
    assert.match(res.headers.get("content-type")!, /^text\/event-stream/);
    const n = await seed(ALICE, "live!");
    await new Promise((r) => setTimeout(r, 50));
    hub.publish(ALICE, { ...n, readAt: null } as never);
    hub.publish(BOB, { ...(await seed(BOB, "secret")) } as never);
    const text = await readUntil(res, "live!");
    ctl.abort();
    assert.ok(text.includes("event: ready"));
    assert.ok(text.includes("live!"));
    assert.ok(!text.includes("secret"));
  });

  test("Last-Event-ID replays what the client missed while disconnected", async () => {
    const seen = await seed(ALICE, "already-seen"); await seed(ALICE, "missed-1"); await seed(ALICE, "missed-2"); await seed(BOB, "not-yours");
    const res = await fetch(`${base}/stream`, { headers: { ...(await auth()), "Last-Event-ID": seen.id } });
    const text = await readUntil(res, "missed-2");
    assert.ok(text.includes("missed-1") && text.includes("missed-2"));
    assert.ok(!text.includes("already-seen") && !text.includes("not-yours"));
  });
});

describe("misc", () => {
  test("health reports push status", async () => {
    const res = await fetch(base.replace("/notifications", "/health"));
    assert.deepEqual(await res.json(), { service: "notification-service", status: "ok", push: "enabled" });
  });
});
