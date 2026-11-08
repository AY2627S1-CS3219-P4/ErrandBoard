import amqp from "amqp-connection-manager";
import type { ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { processStatusEvent, type ProcessorDeps } from "../services/notification.service.js";
import { EXCHANGE_NAME, InvalidStatusEventError, parseStatusEvent, STATUS_EVENT_TYPE } from "./errand-status-event.js";

export const QUEUE_NAME = "notification.errand.status";
export const RETRY_QUEUE = "notification.errand.status.retry";
export const DEAD_EXCHANGE = "notification.errand.status.dead";
export const DEAD_QUEUE = "notification.errand.status.dead";
export const MAX_RETRIES = 5;
export const RETRY_DELAY_MS = 10_000;
const RETRY_HEADER = "x-notification-retry-count";

function retryCount(message: ConsumeMessage): number {
  const value: unknown = message.properties.headers?.[RETRY_HEADER];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

type Acker = Pick<ConfirmChannel, "ack" | "nack">;
type RetrySender = Pick<ChannelWrapper, "sendToQueue">;

/** Exported for tests. Mirrors Credit's consumer: ack on success, retry queue on transient failure, DLQ otherwise. */
export async function handleMessage(channel: Acker, wrapper: RetrySender, message: ConsumeMessage, deps: ProcessorDeps): Promise<void> {
  try {
    const event = parseStatusEvent(message);
    const result = await processStatusEvent(event, deps);
    console.log(`Notified for ${event.value.eventId}: planned=${result.planned} delivered=${result.delivered}`);
    channel.ack(message);
  } catch (error) {
    if (error instanceof InvalidStatusEventError) {
      console.error("Dropping malformed status event to the DLQ:", error.message);
      channel.nack(message, false, false);
      return;
    }

    const attempts = retryCount(message);
    if (attempts >= MAX_RETRIES) {
      console.error(`Status event failed after ${attempts} retries; moving to DLQ:`, error);
      channel.nack(message, false, false);
      return;
    }

    try {
      // A confirmed retry copy must exist before the original delivery is acknowledged.
      await wrapper.sendToQueue(RETRY_QUEUE, message.content, {
        persistent: true,
        contentType: message.properties.contentType,
        messageId: message.properties.messageId,
        headers: { ...message.properties.headers, [RETRY_HEADER]: attempts + 1 },
      });
      console.warn(`Retrying status event ${message.properties.messageId} (attempt ${attempts + 1})`, error);
      channel.ack(message);
    } catch (retryError) {
      console.error("Could not schedule status event retry:", retryError);
      channel.nack(message, false, true); // back to the head of the queue
    }
  }
}

export async function startStatusConsumer(deps: ProcessorDeps): Promise<() => Promise<void>> {
  const url = process.env.RABBITMQ_URL;
  if (!url) throw new Error("RABBITMQ_URL missing");

  const connection = amqp.connect([url]);
  connection.on("connect", () => console.log("Notification RabbitMQ connected"));
  connection.on("connectFailed", ({ err }) => console.error("Notification RabbitMQ connect failed:", err.message));
  connection.on("disconnect", ({ err }) => console.error("Notification RabbitMQ disconnected:", err?.message));

  const wrapper = connection.createChannel({
    setup: async (channel: ConfirmChannel) => {
      await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

      await channel.assertExchange(DEAD_EXCHANGE, "direct", { durable: true });
      await channel.assertQueue(DEAD_QUEUE, { durable: true });
      await channel.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, "failed");

      // Delay queue: messages wait RETRY_DELAY_MS, then are dead-lettered through the DEFAULT
      // exchange straight back into our own queue. (Re-publishing to errand.events would also hit
      // any other consumer bound to the same routing key.)
      await channel.assertQueue(RETRY_QUEUE, {
        durable: true,
        arguments: {
          "x-message-ttl": RETRY_DELAY_MS,
          "x-dead-letter-exchange": "",
          "x-dead-letter-routing-key": QUEUE_NAME,
        },
      });

      await channel.assertQueue(QUEUE_NAME, {
        durable: true,
        arguments: { "x-dead-letter-exchange": DEAD_EXCHANGE, "x-dead-letter-routing-key": "failed" },
      });
      await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, STATUS_EVENT_TYPE);

      await channel.prefetch(10);
      await channel.consume(QUEUE_NAME, (message) => {
        if (message) {
          void handleMessage(channel, wrapper, message, deps).catch((error) => {
            // the broker redelivers an unacknowledged message if its channel closes
            console.error("Status event handler lost its channel:", error);
          });
        }
      }, { noAck: false });
    },
  });

  try {
    await wrapper.waitForConnect();
  } catch (error) {
    await wrapper.close();
    await connection.close();
    throw error;
  }

  console.log(`Notification consumer listening on ${QUEUE_NAME}`);
  return async () => {
    await wrapper.close();
    await connection.close();
  };
}
