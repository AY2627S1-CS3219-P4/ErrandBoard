// src/event/errand.events.ts
import { Errand, type ErrandRecord } from "../models/Errand.js";
import { getEventPublisher } from "./publisher.js";
import { publicEventType, type ErrandEvent, type TerminalCause } from "./types.js";

// Fallback for errands terminated before terminalCause was recorded (or by an untagged path):
// infer the ordinary cause from the terminal status so the payload always carries one.
function defaultCause(status: ErrandRecord["status"]): TerminalCause {
  if (status === "EXPIRED") return "EXPIRED";
  if (status === "COMPLETED") return "CONFIRMED";
  return "REQUESTER_CANCELLED"; // CANCELLED
}

function buildEvent(errand: ErrandRecord): ErrandEvent | undefined {
  const type = publicEventType(errand.status);
  if (!type) return undefined; //not terminal event
  const errandId = errand._id.toString();

  return {
    key: errandId,
    value: {
      eventId: `${errandId}:${type}`,
      type,
      cause: errand.terminalCause ?? defaultCause(errand.status),
      requesterId: errand.requesterId,
      courierId: errand.courierId ?? null,
      credit: errand.credit,
      occurredAt: errand.updatedAt.toISOString(),
    }
  };
}


export async function publishTerminalEvent(errand: ErrandRecord): Promise<boolean> {
  const event = buildEvent(errand);
  if (!event) return true;
  try {
    await getEventPublisher().publish(event);
    await Errand.updateOne(
      { _id: errand._id },
      { $unset: { eventPending: "" } },
      { timestamps: false },          // don't bump updatedAt (it feeds occurredAt)
    );
    return true;
  } catch (err) {
    console.error(`publish ${event.value.eventId} failed, left for relay:`, (err as Error).message);
    return false;
  }
}


// Relay: called from the sweep tick.
export async function flushPendingEvents(limit = 200): Promise<number> {
  const pending = (await Errand.find({ eventPending: true })
    .sort({ updatedAt: 1 })
    .limit(limit)) as unknown as ErrandRecord[];

  const oldest = pending[0];
  if (oldest && Date.now() - oldest.updatedAt.getTime() > 2 * 60_000) {
    console.warn(`Order terminal event backlog: oldest pending errand ${oldest._id} is over two minutes old`);
  }

  let sent = 0;
  for (const errand of pending) {
    if (!(await publishTerminalEvent(errand))) break; // broker likely down, retry next tick
    sent++;
  }
  return sent;
}
