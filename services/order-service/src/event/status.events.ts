// src/event/status.events.ts
//
// Status-change events for the Notification Service.
//
// Delivery follows the same transactional-outbox idea as the terminal settlement events, but it
// is tracked separately and deliberately cannot affect them:
//   * an entry is $pushed onto `errand.notifyOutbox` in the same atomic update as the transition
//     (see updateErrand), and `notifyPending` is set so the relay can find it via a partial index;
//   * we then try to publish immediately; each confirmed entry is $pulled again;
//   * anything left over is retried by the lifecycle sweep (flushPendingStatusEvents).
//
// Delivery is at-least-once. The consumer dedupes on `eventId`.
import { Errand, type ErrandRecord, type StatusOutboxEntry } from "../models/Errand.js";
import type { ErrandStatus } from "../status/errandState.js";
import { getEventPublisher } from "./publisher.js";
import { STATUS_EVENT_TYPE, type StatusChangeEvent } from "./types.js";

// An errand reaches each status at most once (the state machine has no cycles), so
// (errandId, status) is a stable idempotency key.
export function statusEventId(errandId: string, status: ErrandStatus): string {
  return `${errandId}:status:${status}`;
}

export function buildStatusEvent(errand: ErrandRecord, entry: StatusOutboxEntry): StatusChangeEvent {
  const errandId = errand._id.toString();
  return {
    key: errandId,
    value: {
      eventId: entry.eventId,
      type: STATUS_EVENT_TYPE,
      errandId,
      status: entry.status,
      previousStatus: entry.previousStatus,
      actor: { role: entry.actorRole, userId: entry.actorId ?? null },
      requesterId: errand.requesterId,
      // courierId is assigned once (on accept) and never changes, so reading it from the current
      // document is correct even if this entry is relayed after later transitions.
      courierId: errand.courierId ?? null,
      credit: errand.credit,
      supplierName: errand.supplier.name,
      dropoff: errand.dropoff,
      deadline: entry.deadline ? entry.deadline.toISOString() : null,
      occurredAt: entry.at.toISOString(),
    },
  };
}

async function clearFlagIfDrained(errandId: ErrandRecord["_id"]): Promise<void> {
  // The filter makes this safe against a concurrent transition that has just pushed a new entry.
  await Errand.updateOne(
    { _id: errandId, $or: [{ notifyOutbox: { $size: 0 } }, { notifyOutbox: { $exists: false } }] },
    { $unset: { notifyPending: "" } },
    { timestamps: false }, // never bump updatedAt for bookkeeping
  );
}

/**
 * Publishes the errand's pending status events in order. Never throws: on failure the entries stay
 * in the outbox and the sweep retries them. Returns true when the outbox was fully drained.
 */
export async function publishStatusEvents(errand: ErrandRecord): Promise<boolean> {
  const entries = errand.notifyOutbox ?? [];
  if (!entries.length) return true;
  const published: string[] = [];
  let drained = true;

  for (const entry of entries) {
    try {
      await getEventPublisher().publish(buildStatusEvent(errand, entry));
      published.push(entry.eventId);
    } catch (err) {
      console.error(`publish ${entry.eventId} failed, left for relay:`, (err as Error).message);
      drained = false;
      break; // keep per-errand ordering: do not publish later entries ahead of a failed one
    }
  }

  try {
    if (published.length) {
      await Errand.updateOne(
        { _id: errand._id },
        { $pull: { notifyOutbox: { eventId: { $in: published } } } },
        { timestamps: false },
      );
    }
    if (drained) await clearFlagIfDrained(errand._id);
  } catch (err) {
    // Entries stay (or are re-published later); the consumer's eventId dedupe absorbs the repeat.
    console.error(`clearing status outbox for ${errand._id} failed:`, (err as Error).message);
    return false;
  }
  return drained;
}

// Relay: called from the sweep tick.
export async function flushPendingStatusEvents(limit = 200): Promise<number> {
  const pending = (await Errand.find({ notifyPending: true })
    .sort({ updatedAt: 1 })
    .limit(limit)) as unknown as ErrandRecord[];

  const oldest = pending[0]?.notifyOutbox?.[0];
  if (oldest && Date.now() - oldest.at.getTime() > 2 * 60_000) {
    console.warn(`Order status-event backlog: oldest pending entry ${oldest.eventId} is over two minutes old`);
  }

  let sent = 0;
  for (const errand of pending) {
    if (!errand.notifyOutbox?.length) {
      // Flag left behind (e.g. crash between $pull and $unset): nothing to publish, just clear it.
      await clearFlagIfDrained(errand._id).catch((err) =>
        console.error(`clearing stale notifyPending for ${errand._id} failed:`, (err as Error).message));
      continue;
    }
    if (!(await publishStatusEvents(errand))) break; // broker likely down, retry next tick
    sent++;
  }
  return sent;
}
