// src/event/errand.events.ts
import type { ErrandRecord } from "../models/Errand.js";
import { getEventPublisher } from "./publisher.js";
import { publicEventType, type ErrandEvent } from "./types.js";

export async function publishTerminalEvent(errand: ErrandRecord): Promise<void> {
  const type = publicEventType(errand.status);
  if (!type) return; // not a terminal state

  const errandId = errand._id.toString();
  const event: ErrandEvent = {
    // deterministic: an errand reaches a terminal state once, so this doubles as the consumer's dedupe key
    eventId: `${errandId}:${type}`,
    type,
    errandId,
    requesterId: errand.requesterId,
    courierId: errand.courierId ?? null,
    credit: errand.credit,
    occurredAt: errand.updatedAt.toISOString(),
  };
  await getEventPublisher().publish(event);
}
