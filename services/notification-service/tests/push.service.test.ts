import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { buildPushPayload, MAX_CONSECUTIVE_FAILURES, PushDispatcher } from "../src/services/push.service.js";
import { FakeGateway, InMemorySubscriptionStore, sub, view } from "./fakes.js";

let store: InMemorySubscriptionStore;
let gw: FakeGateway;
let push: PushDispatcher;
const payload = () => buildPushPayload(view({ errandId: "e".repeat(24), urgency: "high" }), 3);

beforeEach(() => {
  store = new InMemorySubscriptionStore();
  gw = new FakeGateway();
  push = new PushDispatcher(store, gw);
});

describe("buildPushPayload", () => {
  test("collapses per errand via tag and carries what the service worker needs", () => {
    const p = payload();
    assert.equal(p.tag, `errand-${"e".repeat(24)}`);
    assert.equal(p.v, 1);
    assert.equal(p.unread, 3);
    assert.deepEqual(Object.keys(p).sort(), ["actions", "body", "errandId", "id", "kind", "occurredAt", "tag", "title", "unread", "urgency", "url", "v"]);
    assert.ok(JSON.stringify(p).length < 1000, "well under the ~4KB push limit");
  });
});

describe("PushDispatcher", () => {
  test("delivers to every device the user registered, with urgency, TTL and a collapse topic", async () => {
    await store.upsert("u1", sub("u1", "fcm.googleapis.com", "a"));
    await store.upsert("u1", sub("u1", "web.push.apple.com", "b"));
    await store.upsert("u2", sub("u2", "fcm.googleapis.com", "c"));

    const out = await push.sendToUser("u1", payload());

    assert.deepEqual(out, { sent: 2, removed: 0, failed: 0 });
    assert.equal(gw.sent.length, 2);
    assert.deepEqual(gw.sent[0].opts, { ttlSeconds: 86_400, urgency: "high", topic: "e".repeat(24) });
    assert.equal(JSON.parse(gw.sent[0].body).title, "Errand accepted");
  });

  test("is a no-op when push is disabled or the user has no devices", async () => {
    await store.upsert("u1", sub("u1"));
    assert.deepEqual(await new PushDispatcher(store, null).sendToUser("u1", payload()), { sent: 0, removed: 0, failed: 0 });
    assert.deepEqual(await push.sendToUser("nobody", payload()), { sent: 0, removed: 0, failed: 0 });
  });

  for (const status of [404, 410]) {
    test(`${status} means the browser is gone: the subscription is deleted`, async () => {
      const s = sub("u1"); await store.upsert("u1", s); gw.failures.set(s.endpoint, status);
      assert.deepEqual(await push.sendToUser("u1", payload()), { sent: 0, removed: 1, failed: 0 });
      assert.equal(store.subs.length, 0);
    });
  }

  test("one dead device does not stop delivery to the others", async () => {
    const dead = sub("u1", "fcm.googleapis.com", "dead"), live = sub("u1", "web.push.apple.com", "live");
    await store.upsert("u1", dead); await store.upsert("u1", live); gw.failures.set(dead.endpoint, 410);
    const out = await push.sendToUser("u1", payload());
    assert.deepEqual(out, { sent: 1, removed: 1, failed: 0 });
    assert.deepEqual(store.subs.map((s) => s.endpoint), [live.endpoint]);
  });

  test("transient failures are counted, and the device is dropped only after repeated failures", async (t) => {
    t.mock.method(console, "warn", () => {});
    const s = sub("u1"); await store.upsert("u1", s); gw.failures.set(s.endpoint, 503);
    for (let i = 1; i < MAX_CONSECUTIVE_FAILURES; i++) {
      assert.deepEqual(await push.sendToUser("u1", payload()), { sent: 0, removed: 0, failed: 1 });
      assert.equal(store.subs[0].failureCount, i);
    }
    assert.deepEqual(await push.sendToUser("u1", payload()), { sent: 0, removed: 1, failed: 1 });
    assert.equal(store.subs.length, 0);
  });

  test("a success resets the failure counter", async (t) => {
    t.mock.method(console, "warn", () => {});
    const s = sub("u1"); await store.upsert("u1", s);
    gw.failures.set(s.endpoint, undefined); await push.sendToUser("u1", payload());
    assert.equal(store.subs[0].failureCount, 1);
    gw.failures.delete(s.endpoint); await push.sendToUser("u1", payload());
    assert.equal(store.subs[0].failureCount, 0);
  });

  test("VAPID rejection (401/403) is our configuration fault: log loudly, never delete users' devices", async (t) => {
    const err = t.mock.method(console, "error", () => {});
    const s = sub("u1"); await store.upsert("u1", s); gw.failures.set(s.endpoint, 403);
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES + 2; i++) await push.sendToUser("u1", payload());
    assert.equal(store.subs.length, 1);
    assert.ok(err.mock.callCount() > 0);
  });
});
