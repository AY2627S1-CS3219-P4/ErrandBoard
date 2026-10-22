import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChannelWrapper } from "amqp-connection-manager";
import { PublishError, RabbitPublisher, UnroutableError } from "../src/event/rabbit.publisher.js";
import type { ErrandEvent } from "../src/event/types.js";

const event: ErrandEvent = {
  key: "errand-1",
  value: {
    eventId: "errand-1:errand.completed",
    type: "errand.completed",
    requesterId: "requester-1",
    courierId: "courier-1",
    credit: 5,
    occurredAt: new Date().toISOString(),
  },
};

type PublishCall = { exchange: string; routingKey: string; body: Buffer; options: Record<string, unknown> };

// Fake channel: `onPublish` runs inside publish(), like the broker's return arriving before the confirm.
function makePublisher(onPublish: (calls: PublishCall[], returns: Set<string>) => Promise<void> | void = () => {}) {
  const calls: PublishCall[] = [];
  const returns = new Set<string>();
  const channel = {
    publish: async (exchange: string, routingKey: string, body: Buffer, options: Record<string, unknown>) => {
      calls.push({ exchange, routingKey, body, options });
      await onPublish(calls, returns);
      return true;
    },
  } as unknown as ChannelWrapper;
  return { publisher: new RabbitPublisher(channel, () => true, async () => {}, returns), calls, returns };
}

describe("RabbitPublisher.publish", () => {
  test("publishes a persistent, mandatory message keyed by eventId, with a timeout", async () => {
    const { publisher, calls } = makePublisher();

    await publisher.publish(event);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].exchange, "errand.events");
    assert.equal(calls[0].routingKey, "errand.completed");
    assert.deepEqual(JSON.parse(calls[0].body.toString()), event);
    assert.equal(calls[0].options.persistent, true);
    assert.equal(calls[0].options.mandatory, true);
    assert.equal(calls[0].options.messageId, event.value.eventId);
    assert.equal(typeof calls[0].options.timeout, "number");
  });

  test("throws UnroutableError when the broker returns the message", async () => {
    const { publisher, returns } = makePublisher((_calls, r) => { r.add(event.value.eventId); });

    await assert.rejects(publisher.publish(event), (err: unknown) =>
      err instanceof UnroutableError && err instanceof PublishError && err.message.includes(event.value.eventId));
    assert.equal(returns.has(event.value.eventId), false, "return marker is consumed");
  });

  test("wraps a channel failure in PublishError, keeps the cause, and clears the marker", async () => {
    const cause = new Error("timeout");
    const { publisher, returns } = makePublisher((_calls, r) => {
      r.add(event.value.eventId); // returned, then the confirm failed
      throw cause;
    });

    await assert.rejects(publisher.publish(event), (err: unknown) =>
      err instanceof PublishError && !(err instanceof UnroutableError) && (err as Error).cause === cause);
    assert.equal(returns.size, 0);
  });

  test("a stale return marker from an earlier attempt does not fail a successful retry", async () => {
    const { publisher, returns } = makePublisher();
    returns.add(event.value.eventId); // left behind by a previous attempt

    await assert.doesNotReject(publisher.publish(event));
    assert.equal(returns.size, 0);
  });

  test("a marker for a different event is left alone", async () => {
    const { publisher, returns } = makePublisher();
    returns.add("other:errand.expired");

    await publisher.publish(event);

    assert.equal(returns.has("other:errand.expired"), true);
  });
});
