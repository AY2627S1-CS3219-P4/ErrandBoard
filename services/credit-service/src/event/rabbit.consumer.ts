import amqp from "amqp-connection-manager";
import type { ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { CreditOperationError } from "../services/credit-operations.service.js";
import { notifyCreditBalanceUpdated } from "../events/credit-balance-events.js";
import {
  applyErrandEvent,
  EVENT_TYPES,
  EXCHANGE_NAME,
  InvalidErrandEventError,
  parseErrandEvent,
} from "./errand-event.js";

const QUEUE_NAME = "credit.errand.events";
const RETRY_EXCHANGE = "credit.errand.events.retry";
const RETRY_QUEUE = "credit.errand.events.retry";
const DEAD_EXCHANGE = "credit.errand.events.dead";
const DEAD_QUEUE = "credit.errand.events.dead";
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 10_000;
const RETRY_HEADER = "x-credit-retry-count";

function retryCount(message: ConsumeMessage): number {
  const value: unknown = message.properties.headers?.[RETRY_HEADER];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function handleMessage(
  channel: ConfirmChannel,
  wrapper: ChannelWrapper,
  message: ConsumeMessage,
): Promise<void> {
  try {
    const event = parseErrandEvent(message);
    const result = await applyErrandEvent(event);
    console.log(`Credit settled ${event.value.eventId}; applied=${result.applied}`);
    const affectedUsers = [event.value.requesterId];
    if (event.value.type === "errand.completed" && event.value.courierId) {
      affectedUsers.push(event.value.courierId);
    }
    // Also signal successful duplicate deliveries so reconnecting clients can
    // refresh after a previous notification was missed.
    notifyCreditBalanceUpdated(affectedUsers);
    channel.ack(message);
  } catch (error) {
    if (error instanceof InvalidErrandEventError ||
        error instanceof CreditOperationError && (error.status === 400 || error.status === 409)) {
      console.error("Credit event needs reconciliation:", error);
      channel.nack(message, false, false);
      return;
    }

    const attempts = retryCount(message);
    if (attempts >= MAX_RETRIES) {
      console.error(`Credit event failed after ${attempts} retries:`, error);
      channel.nack(message, false, false);
      return;
    }

    try {
      // A confirmed retry copy must exist before removing the original delivery.
      await wrapper.publish(RETRY_EXCHANGE, message.fields.routingKey, message.content, {
        persistent: true,
        contentType: message.properties.contentType,
        messageId: message.properties.messageId,
        headers: { ...message.properties.headers, [RETRY_HEADER]: attempts + 1 },
      });
      console.warn(`Retrying credit event ${message.properties.messageId} (attempt ${attempts + 1})`, error);
      channel.ack(message);
    } catch (retryError) {
      console.error("Could not schedule Credit event retry:", retryError);
      channel.nack(message, false, true);
    }
  }
}

export async function startErrandConsumer(): Promise<() => Promise<void>> {
  const url = process.env.RABBITMQ_URL;
  if (!url) throw new Error("RABBITMQ_URL missing");

  const connection = amqp.connect([url]);
  connection.on("connect", () => console.log("Credit RabbitMQ connected"));
  connection.on("connectFailed", ({ err }) => console.error("Credit RabbitMQ connect failed:", err.message));
  connection.on("disconnect", ({ err }) => console.error("Credit RabbitMQ disconnected:", err?.message));

  const wrapper = connection.createChannel({
    setup: async (channel: ConfirmChannel) => {
      await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
      await channel.assertExchange(RETRY_EXCHANGE, "topic", { durable: true });
      await channel.assertExchange(DEAD_EXCHANGE, "direct", { durable: true });

      await channel.assertQueue(DEAD_QUEUE, { durable: true });
      await channel.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, "failed");

      await channel.assertQueue(RETRY_QUEUE, {
        durable: true,
        arguments: {
          "x-message-ttl": RETRY_DELAY_MS,
          "x-dead-letter-exchange": EXCHANGE_NAME,
        },
      });
      for (const type of EVENT_TYPES) {
        await channel.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, type);
      }

      await channel.assertQueue(QUEUE_NAME, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": DEAD_EXCHANGE,
          "x-dead-letter-routing-key": "failed",
        },
      });
      for (const type of EVENT_TYPES) {
        await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, type);
      }

      await channel.prefetch(5);
      await channel.consume(QUEUE_NAME, (message) => {
        if (message) {
          void handleMessage(channel, wrapper, message).catch((error) => {
            // The broker requeues an unacknowledged delivery if its channel closes.
            console.error("Credit event handler lost its channel:", error);
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

  console.log(`Credit consumer listening on ${QUEUE_NAME}`);
  return async () => {
    await wrapper.close();
    await connection.close();
  };
}
