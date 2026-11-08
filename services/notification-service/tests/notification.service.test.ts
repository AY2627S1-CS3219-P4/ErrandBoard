import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { StatusChangeEvent } from "../src/event/errand-status-event.js";
import { LiveHub } from "../src/services/live-hub.js";
import { processStatusEvent, type ProcessorDeps } from "../src/services/notification.service.js";
import { PushDispatcher } from "../src/services/push.service.js";
import { FakeGateway, FakeSse, InMemoryNotificationStore, InMemorySubscriptionStore, sub } from "./fakes.js";

const ERRAND = "a".repeat(24), REQ = "1".repeat(24), COU = "2".repeat(24);
const event = (over: Partial<StatusChangeEvent["value"]> = {}): StatusChangeEvent => ({
  key: ERRAND,
  value: {
    eventId: `${ERRAND}:status:PENDING_COMPLETION`, type: "errand.status.changed", errandId: ERRAND, status: "PENDING_COMPLETION", previousStatus: "PICKED_UP",
    actor: { role: "COURIER", userId: COU }, requesterId: REQ, courierId: COU, credit: 5, supplierName: "Fine Food", dropoff: "COM1 lobby",
    deadline: "2026-11-05T08:00:00.000Z", occurredAt: "2026-11-03T08:00:00.000Z", ...over,
  },
});

let notifications: InMemoryNotificationStore, subs: InMemorySubscriptionStore, gw: FakeGateway, hub: LiveHub, deps: ProcessorDeps;
beforeEach(() => {
  notifications = new InMemoryNotificationStore(); subs = new InMemorySubscriptionStore(); gw = new FakeGateway();
  hub = new LiveHub({ heartbeatMs: 60_000, maxAgeMs: 60_000, maxPerUser: 5 });
  deps = { notifications, hub, push: new PushDispatcher(subs, gw), rules: { directActions: true }, errandPath: (id) => `/errands/${id}` };
});

describe("processStatusEvent", () => {
  test("stores an inbox row and delivers it live AND by push, with the unread count", async () => {
    const live = new FakeSse(); hub.subscribe(REQ, live.res);
    await subs.upsert(REQ, sub(REQ));

    const result = await processStatusEvent(event(), deps);

    assert.deepEqual(result, { planned: 1, delivered: 1 });
    assert.equal(notifications.rows.length, 1);
    const row = notifications.rows[0];
    assert.equal(row.userId, REQ);
    assert.equal(row.url, `/errands/${ERRAND}`);
    assert.equal(row.fanoutDone, true);
    assert.ok(live.text.includes(`id: ${row.id}`));
    assert.equal(gw.sent.length, 1);
    const payload = JSON.parse(gw.sent[0].body);
    assert.equal(payload.unread, 1);
    assert.equal(payload.actions[0].action, "confirm");
    assert.equal(payload.actions[0].request.path, `/errands/${ERRAND}/complete`);
    live.end();
  });

  test("the courier who acted gets nothing; only the requester's devices are pushed", async () => {
    await subs.upsert(REQ, sub(REQ, "fcm.googleapis.com", "r")); await subs.upsert(COU, sub(COU, "fcm.googleapis.com", "c"));
    await processStatusEvent(event(), deps);
    assert.deepEqual(gw.sent.map((s) => s.endpoint), [sub(REQ, "fcm.googleapis.com", "r").endpoint]);
    assert.equal(notifications.rows.every((r) => r.userId === REQ), true);
  });

  test("redelivery of a fully processed event does nothing (idempotent)", async () => {
    await subs.upsert(REQ, sub(REQ));
    await processStatusEvent(event(), deps);
    const again = await processStatusEvent(event(), deps);
    assert.deepEqual(again, { planned: 1, delivered: 0 });
    assert.equal(notifications.rows.length, 1);
    assert.equal(gw.sent.length, 1);
  });

  test("redelivery after a crash between insert and delivery finishes the delivery", async () => {
    await subs.upsert(REQ, sub(REQ));
    // first attempt: row inserted, but the process died before fan-out completed
    await notifications.insertIfAbsent({
      userId: REQ, eventId: event().value.eventId, errandId: ERRAND, kind: "ERRAND_DELIVERED", title: "t", body: "b", url: "/u",
      recipientRole: "REQUESTER", urgency: "high", actions: [], occurredAt: new Date(),
    });
    const result = await processStatusEvent(event(), deps);
    assert.equal(result.delivered, 1);
    assert.equal(gw.sent.length, 1);
    assert.equal(notifications.rows.length, 1, "no duplicate row");
  });

  test("events that need no notification complete cleanly", async () => {
    const r = await processStatusEvent(event({ status: "CANCELLED", previousStatus: "OPEN", courierId: null, actor: { role: "REQUESTER", userId: REQ } }), deps);
    assert.deepEqual(r, { planned: 0, delivered: 0 });
    assert.equal(notifications.rows.length, 0);
  });

  test("sweep-driven completion notifies both parties", async () => {
    await processStatusEvent(event({ status: "COMPLETED", previousStatus: "PENDING_COMPLETION", eventId: `${ERRAND}:status:COMPLETED`, actor: { role: "SYSTEM", userId: null } }), deps);
    assert.deepEqual(notifications.rows.map((r) => r.userId).sort(), [REQ, COU].sort());
  });

  test("a push failure does not fail the event or lose the inbox row", async (t) => {
    t.mock.method(console, "warn", () => {});
    const s = sub(REQ); await subs.upsert(REQ, s); gw.failures.set(s.endpoint, 500);
    const r = await processStatusEvent(event(), deps);
    assert.equal(r.delivered, 1);
    assert.equal(notifications.rows.length, 1);
  });

  test("a database error propagates so the message is retried, and the retry succeeds", async () => {
    notifications.failNext = new Error("mongo down");
    await assert.rejects(processStatusEvent(event(), deps), /mongo down/);
    const r = await processStatusEvent(event(), deps);
    assert.equal(r.delivered, 1);
  });
});
