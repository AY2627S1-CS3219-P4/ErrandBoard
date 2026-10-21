import { Types } from "mongoose";
import type { ConsumeMessage } from "amqplib";
import {
  refundCredits,
  transferCredits,
  type CreditOperationResult,
} from "../services/credit-operations.service.js";

export const EXCHANGE_NAME = "errand.events";
export const EVENT_TYPES = ["errand.completed", "errand.cancelled", "errand.expired"] as const;

type EventType = (typeof EVENT_TYPES)[number];

export interface ErrandEvent {
  key: string;
  value: {
    eventId: string;
    type: EventType;
    requesterId: string;
    courierId: string | null;
    credit: number;
    occurredAt: string;
  };
}

export class InvalidErrandEventError extends Error {}

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);
}

export function parseErrandEvent(message: ConsumeMessage): ErrandEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(message.content.toString("utf8"));
  } catch {
    throw new InvalidErrandEventError("Event body is not valid JSON");
  }

  if (typeof payload !== "object" || payload === null || !("key" in payload) ||
      !("value" in payload) || typeof payload.value !== "object" || payload.value === null) {
    throw new InvalidErrandEventError("Event must contain key and value");
  }

  const { key, value } = payload;
  if (!isObjectId(key) || !("type" in value) || !EVENT_TYPES.includes(value.type as EventType) ||
      !("eventId" in value) || value.eventId !== `${key}:${value.type}` ||
      message.fields.routingKey !== value.type ||
      message.properties.messageId !== value.eventId ||
      !("requesterId" in value) || !isObjectId(value.requesterId) ||
      !("courierId" in value) ||
      !(value.courierId === null || isObjectId(value.courierId)) ||
      !("credit" in value) || !Number.isSafeInteger(value.credit) || (value.credit as number) <= 0 ||
      !("occurredAt" in value) || typeof value.occurredAt !== "string" ||
      Number.isNaN(Date.parse(value.occurredAt))) {
    throw new InvalidErrandEventError("Event fields do not match the Order event contract");
  }

  if (value.type === "errand.completed" &&
      (!isObjectId(value.courierId) || value.courierId === value.requesterId)) {
    throw new InvalidErrandEventError("Completed event needs a different courier");
  }

  return payload as ErrandEvent;
}

export function applyErrandEvent(event: ErrandEvent): Promise<CreditOperationResult> {
  const operation = {
    orderId: new Types.ObjectId(event.key),
    requesterId: new Types.ObjectId(event.value.requesterId),
    amount: event.value.credit,
  };

  if (event.value.type === "errand.completed") {
    return transferCredits({
      ...operation,
      courierId: new Types.ObjectId(event.value.courierId!),
    });
  }
  return refundCredits(operation);
}
