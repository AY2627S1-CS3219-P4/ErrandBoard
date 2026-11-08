import type { ConsumeMessage } from "amqplib";

// Contract published by the Order Service (src/event/status.events.ts). Services do not share code,
// so it is mirrored here and validated strictly: anything that does not match goes to the DLQ.
export const EXCHANGE_NAME = "errand.events";
export const STATUS_EVENT_TYPE = "errand.status.changed";

export const ERRAND_STATUSES = ["OPEN", "ACCEPTED", "PICKED_UP", "PENDING_COMPLETION", "COMPLETED", "CANCELLED", "EXPIRED"] as const;
export type ErrandStatus = (typeof ERRAND_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ErrandStatus, readonly ErrandStatus[]> = {
  OPEN: ["ACCEPTED", "CANCELLED", "EXPIRED"],
  ACCEPTED: ["PICKED_UP", "CANCELLED"],
  PICKED_UP: ["PENDING_COMPLETION", "CANCELLED"],
  PENDING_COMPLETION: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export interface StatusChangeEvent {
  key: string;
  value: {
    eventId: string;
    type: typeof STATUS_EVENT_TYPE;
    errandId: string;
    status: ErrandStatus;
    previousStatus: ErrandStatus;
    actor: { role: "REQUESTER" | "COURIER" | "SYSTEM"; userId: string | null };
    requesterId: string;
    courierId: string | null;
    credit: number;
    supplierName: string;
    dropoff: string;
    deadline: string | null;
    occurredAt: string;
  };
}

export class InvalidStatusEventError extends Error {}

const isObjectId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isIsoDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));


//holy wall of text but basically verifies the status event is not corrupted
//define a fail function that basically throws an event error if any of the checks fail
//checks include: message body not JSON, payload empty/not object, key is not errand id, missing value, unknown status type, unallowed transition, eventID mismatch,
//incorrect acotrs,  invalid user Id, invalid credit value, invalid date values 
export function parseStatusEvent(message: Pick<ConsumeMessage, "content" | "properties">): StatusChangeEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(message.content.toString("utf8"));
  } catch {
    throw new InvalidStatusEventError("Event body is not valid JSON");
  }
  const fail = (why: string): never => { throw new InvalidStatusEventError(`Invalid status event: ${why}`); };

  if (typeof payload !== "object" || payload === null) return fail("not an object");
  const { key, value } = payload as { key?: unknown; value?: Record<string, unknown> | null };
  if (!isObjectId(key)) return fail("key must be an errand id");
  if (typeof value !== "object" || value === null) return fail("missing value");

  // (the routing key is not checked: retried messages are dead-lettered back through the default exchange)
  if (value.type !== STATUS_EVENT_TYPE) return fail("wrong type");
  if (value.errandId !== key) return fail("errandId must equal key");
  const status = value.status as ErrandStatus;
  const previousStatus = value.previousStatus as ErrandStatus;
  if (!ERRAND_STATUSES.includes(status) || !ERRAND_STATUSES.includes(previousStatus)) return fail("unknown status");
  if (!ALLOWED_TRANSITIONS[previousStatus].includes(status)) return fail(`impossible transition ${previousStatus} -> ${status}`);
  if (value.eventId !== `${key}:status:${status}` || message.properties.messageId !== value.eventId) return fail("eventId mismatch");

  const actor = value.actor as { role?: unknown; userId?: unknown } | null;
  if (typeof actor !== "object" || actor === null || !["REQUESTER", "COURIER", "SYSTEM"].includes(actor.role as string)) return fail("bad actor");
  if (actor.role === "SYSTEM" ? actor.userId !== null : !isObjectId(actor.userId)) return fail("bad actor id");

  if (!isObjectId(value.requesterId)) return fail("bad requesterId");
  if (!(value.courierId === null || isObjectId(value.courierId))) return fail("bad courierId");
  if (value.courierId === value.requesterId) return fail("requester and courier must differ");
  if (!Number.isSafeInteger(value.credit) || (value.credit as number) <= 0) return fail("bad credit");
  if (!isText(value.supplierName, 200) || !isText(value.dropoff, 200)) return fail("bad supplier/dropoff");
  if (!(value.deadline === null || isIsoDate(value.deadline))) return fail("bad deadline");
  if (!isIsoDate(value.occurredAt)) return fail("bad occurredAt");

  return payload as StatusChangeEvent;
}
