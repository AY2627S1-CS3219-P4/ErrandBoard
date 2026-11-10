import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ConsumeMessage } from "amqplib";
import { handleMessage, MAX_RETRIES, RETRY_QUEUE } from "../src/event/rabbit.consumer.js";
import { LiveHub } from "../src/services/live-hub.js";
import type { ProcessorDeps } from "../src/services/notification.service.js";
import { PushDispatcher } from "../src/services/push.service.js";
import { FakeGateway, InMemoryNotificationStore, InMemorySubscriptionStore } from "./fakes.js";

const ID = "a".repeat(24), REQ = "1".repeat(24), COU = "2".repeat(24);
const body = () => ({
  key: ID,
  value: { eventId: `${ID}:status:ACCEPTED`, type: "errand.status.changed", errandId: ID, status: "ACCEPTED", previousStatus: "OPEN", actor: { role: "COURIER", userId: COU },
    requesterId: REQ, courierId: COU, credit: 5, supplierName: "Fine Food", dropoff: "COM1", deadline: null, occurredAt: "2026-11-03T08:00:00.000Z" },
});
const message = (content: unknown, headers: Record<string, unknown> = {}): ConsumeMessage => ({
  content: Buffer.from(typeof content === "string" ? content : JSON.stringify(content)),
  fields: { routingKey: "errand.status.changed" },
  properties: { messageId: `${ID}:status:ACCEPTED`, contentType: "application/json", headers },
}) as unknown as ConsumeMessage;

function setup() {
  const notifications = new InMemoryNotificationStore();
  const deps: ProcessorDeps = { notifications, hub: new LiveHub(), push: new PushDispatcher(new InMemorySubscriptionStore(), new FakeGateway()), rules: { directActions: true, reviewPath: (i: string) => `/errands/active?review=${i}` }, errandPath: (i) => `/errands/${i}` };
  const log: string[] = []; const sent: { queue: string; opts: any }[] = [];
  const channel = { ack: () => { log.push("ack"); }, nack: (_m: unknown, _all: boolean, requeue: boolean) => { log.push(`nack requeue=${requeue}`); } } as never;
  const wrapper = { sendToQueue: async (queue: string, _c: Buffer, opts: any) => { sent.push({ queue, opts }); return true; } } as never;
  return { notifications, deps, log, sent, channel, wrapper };
}

describe("consumer handleMessage", () => {
  test("acks after the notification was stored", async (t) => {
    t.mock.method(console, "log", () => {});
    const s = setup();
    await handleMessage(s.channel, s.wrapper, message(body()), s.deps);
    assert.deepEqual(s.log, ["ack"]);
    assert.equal(s.notifications.rows.length, 1);
  });

  test("a malformed event goes straight to the DLQ (nack without requeue), never retried", async (t) => {
    t.mock.method(console, "error", () => {});
    const s = setup();
    await handleMessage(s.channel, s.wrapper, message("{garbage"), s.deps);
    assert.deepEqual(s.log, ["nack requeue=false"]);
    assert.equal(s.sent.length, 0);
  });

  test("a transient failure is re-queued to the delay queue with an incremented counter, then acked", async (t) => {
    t.mock.method(console, "warn", () => {});
    const s = setup(); s.notifications.failNext = new Error("mongo down");
    await handleMessage(s.channel, s.wrapper, message(body(), { "x-notification-retry-count": 2 }), s.deps);
    assert.equal(s.sent[0].queue, RETRY_QUEUE);
    assert.equal(s.sent[0].opts.headers["x-notification-retry-count"], 3);
    assert.equal(s.sent[0].opts.persistent, true);
    assert.equal(s.sent[0].opts.messageId, `${ID}:status:ACCEPTED`);
    assert.deepEqual(s.log, ["ack"]);
  });

  test("after the maximum retries the message is dead-lettered", async (t) => {
    t.mock.method(console, "error", () => {});
    const s = setup(); s.notifications.failNext = new Error("still down");
    await handleMessage(s.channel, s.wrapper, message(body(), { "x-notification-retry-count": MAX_RETRIES }), s.deps);
    assert.deepEqual(s.log, ["nack requeue=false"]);
    assert.equal(s.sent.length, 0);
  });

  test("if the retry copy cannot be confirmed the original is requeued, never dropped", async (t) => {
    t.mock.method(console, "error", () => {}); t.mock.method(console, "warn", () => {});
    const s = setup(); s.notifications.failNext = new Error("mongo down");
    const wrapper = { sendToQueue: async () => { throw new Error("broker nack"); } } as never;
    await handleMessage(s.channel, wrapper, message(body()), s.deps);
    assert.deepEqual(s.log, ["nack requeue=true"]);
  });

  test("a garbage retry header is treated as zero", async (t) => {
    t.mock.method(console, "warn", () => {});
    const s = setup(); s.notifications.failNext = new Error("x");
    await handleMessage(s.channel, s.wrapper, message(body(), { "x-notification-retry-count": "lots" }), s.deps);
    assert.equal(s.sent[0].opts.headers["x-notification-retry-count"], 1);
  });
});
