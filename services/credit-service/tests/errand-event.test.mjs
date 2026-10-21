import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InvalidErrandEventError,
  parseErrandEvent,
} from "../dist/event/errand-event.js";

const orderId = "507f1f77bcf86cd799439011";
const requesterId = "507f191e810c19729de860ea";
const courierId = "507f1f77bcf86cd799439012";

function delivery(type = "errand.cancelled", changes = {}) {
  const eventId = `${orderId}:${type}`;
  const event = {
    key: orderId,
    value: {
      eventId,
      type,
      requesterId,
      courierId: type === "errand.completed" ? courierId : null,
      credit: 5,
      occurredAt: "2026-10-21T05:00:00.000Z",
      ...changes,
    },
  };
  return {
    content: Buffer.from(JSON.stringify(event)),
    fields: { routingKey: type },
    properties: { messageId: eventId },
  };
}

test("accepts the Order service's terminal event formats", () => {
  for (const type of ["errand.cancelled", "errand.expired", "errand.completed"]) {
    const message = delivery(type);
    assert.deepEqual(parseErrandEvent(message), JSON.parse(message.content.toString()));
  }
});

test("rejects messages whose route and body disagree", () => {
  const message = delivery();
  message.fields.routingKey = "errand.completed";
  assert.throws(() => parseErrandEvent(message), InvalidErrandEventError);
});

test("rejects completion without a valid courier", () => {
  assert.throws(
    () => parseErrandEvent(delivery("errand.completed", { courierId: null })),
    InvalidErrandEventError,
  );
});

test("rejects malformed identifiers, amounts, and JSON", () => {
  assert.throws(() => parseErrandEvent(delivery("errand.cancelled", { requesterId: "bad" })), InvalidErrandEventError);
  assert.throws(() => parseErrandEvent(delivery("errand.cancelled", { credit: -1 })), InvalidErrandEventError);
  const message = delivery();
  message.content = Buffer.from("{broken");
  assert.throws(() => parseErrandEvent(message), InvalidErrandEventError);
});
