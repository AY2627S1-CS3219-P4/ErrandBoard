import { Errand } from "../models/Errand.js";
import {
  expireOpenErrand,
  cancelErrandAfterDeadline,
  completeErrandAfterDeadline,
} from "../services/order.services.js";
import { ErrandStatus } from "../status/errandState.js";
import { flushPendingEvents } from "../event/errand.events.js";

// most due errands a single sweep tick handles per status; the rest wait for the next tick
const LIFECYCLE_SWEEP_BATCH = 200;

async function sweep(
  status: ErrandStatus,
  field: "expiresAt" | "deliverBy" | "confirmBy",
  transition: (id: string) => Promise<unknown>,
  now: Date,
) {
  const due = await Errand.find({ status, [field]: { $lte: now } })
    .select("_id")
    .limit(LIFECYCLE_SWEEP_BATCH)
    .lean();

  for (const { _id } of due) {
    try {
      console.log(`Processing ${status} errand ${_id}`)
      await transition(_id.toString());
      console.log(`Applied ${transition.name} transition to ${status} errand ${_id}`)
    } catch (err) {
      console.warn(`lifecycle sweep skip ${status} ${_id}:`, (err as Error).message);
    }
  }
  return due.length;
}

export async function runLifecycleSweep() {
  const now = new Date();
  await flushPendingEvents();
  await sweep("OPEN", "expiresAt", expireOpenErrand, now);
  await sweep("PICKED_UP", "deliverBy", cancelErrandAfterDeadline, now);
  await sweep("PENDING_COMPLETION", "confirmBy", completeErrandAfterDeadline, now);
}
