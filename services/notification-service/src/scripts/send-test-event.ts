// Smoke-tests the whole pipeline without touching the Order Service:
//   npm run dev:send-test-event -- <requesterId> <courierId> [STATUS]
// Publishes a well-formed errand.status.changed event to the broker exactly as Order would.
// STATUS defaults to PENDING_COMPLETION (the interactive "Confirm receipt" notification).
import { randomBytes } from "node:crypto";
import amqp from "amqplib";
import { EXCHANGE_NAME, STATUS_EVENT_TYPE, type ErrandStatus } from "../event/errand-status-event.js";

const [requesterId, courierId, status = "PENDING_COMPLETION"] = process.argv.slice(2);
const PREVIOUS: Record<string, ErrandStatus> = {
  ACCEPTED: "OPEN", PICKED_UP: "ACCEPTED", PENDING_COMPLETION: "PICKED_UP", COMPLETED: "PENDING_COMPLETION", CANCELLED: "ACCEPTED", EXPIRED: "OPEN",
};
const objectId = /^[0-9a-f]{24}$/i;

if (!objectId.test(requesterId ?? "") || !objectId.test(courierId ?? "") || !PREVIOUS[status]) {
  console.error("usage: send-test-event <requesterId(24 hex)> <courierId(24 hex)> [ACCEPTED|PICKED_UP|PENDING_COMPLETION|COMPLETED|CANCELLED|EXPIRED]");
  process.exit(1);
}

const url = process.env.RABBITMQ_URL;
if (!url) { console.error("RABBITMQ_URL missing"); process.exit(1); }

const errandId = randomBytes(12).toString("hex"); // fresh id each run so the inbox row is not deduped away
const now = new Date();
const courierActs = ["ACCEPTED", "PICKED_UP", "PENDING_COMPLETION", "CANCELLED"].includes(status);
const event = {
  key: errandId,
  value: {
    eventId: `${errandId}:status:${status}`,
    type: STATUS_EVENT_TYPE,
    errandId,
    status,
    previousStatus: PREVIOUS[status],
    actor: courierActs ? { role: "COURIER", userId: courierId } : { role: "REQUESTER", userId: requesterId },
    requesterId,
    courierId,
    credit: 5,
    supplierName: "Fine Food (test)",
    dropoff: "COM1 lobby",
    deadline: status === "PENDING_COMPLETION" ? new Date(now.getTime() + 2 * 86_400_000).toISOString() : null,
    occurredAt: now.toISOString(),
  },
};

const connection = await amqp.connect(url);
const channel = await connection.createConfirmChannel();
await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
channel.publish(EXCHANGE_NAME, STATUS_EVENT_TYPE, Buffer.from(JSON.stringify(event)), {
  persistent: true, contentType: "application/json", messageId: event.value.eventId,
});
await channel.waitForConfirms();
console.log(`published ${event.value.eventId}`);
await channel.close();
await connection.close();
