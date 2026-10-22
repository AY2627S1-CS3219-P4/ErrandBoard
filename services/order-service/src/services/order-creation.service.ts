import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { inspectReservation, releaseReservation, reservationMatches, type CreditInput } from "../clients/credit.client.js";
import { CreditRecoveryRequiredError } from "../errors/order.errors.js";
import { Errand, type ErrandDocument, type ErrandRecord } from "../models/Errand.js";
import { OrderCreation, type OrderCreationDocument, type CreationState } from "../models/OrderCreation.js";

const IN_FLIGHT_GRACE_MS = 60_000;
const LEASE_MS = 30_000;
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

export function nextCreationRetryDelay(attempts: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.min(Math.max(0, attempts - 1), 16));
}

export async function recordOrderCreation(input: CreditInput): Promise<void> {
  await OrderCreation.create({
    _id: new Types.ObjectId(input.orderId),
    requesterId: input.requesterId,
    amount: input.amount,
    state: "PENDING",
    retryAt: new Date(Date.now() + IN_FLIGHT_GRACE_MS),
    retryAttempts: 0,
  });
}

async function updateCreation(
  orderId: string,
  state: CreationState,
  leaseId?: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await OrderCreation.updateOne(
    { _id: orderId, state: "PENDING", ...(leaseId ? { leaseId } : {}) },
    { $set: { state, ...extra }, $unset: { leaseId: "", leaseUntil: "" } },
  );
}

/** The Errand and intent completion must commit together so recovery cannot refund a live order. */
export async function saveErrandAndCompleteCreation(
  data: Pick<ErrandDocument, "requesterId" | "supplier" | "dropoff" | "description" | "credit" | "status" | "expiresAt"> & { _id: Types.ObjectId },
): Promise<ErrandRecord> {
  const session = await mongoose.startSession();
  let errand: ErrandRecord | undefined;
  try {
    await session.withTransaction(async () => {
      const updated = await OrderCreation.updateOne(
        { _id: data._id, state: "PENDING", leaseId: { $exists: false } },
        { $set: { state: "COMPLETED" }, $unset: { leaseId: "", leaseUntil: "" } },
        { session },
      );
      if (updated.matchedCount !== 1) throw new CreditRecoveryRequiredError();
      const created = await Errand.create([data], { session });
      errand = created[0] as ErrandRecord;
    });
    if (!errand) throw new Error("Errand transaction completed without a saved Errand");
    return errand;
  } finally {
    await session.endSession();
  }
}

export async function closeUnreservedCreation(orderId: string): Promise<void> {
  await updateCreation(orderId, "COMPENSATED");
}

export async function queueCreationRecovery(orderId: string, error: unknown): Promise<void> {
  await OrderCreation.updateOne(
    { _id: orderId, state: "PENDING" },
    { $set: { retryAt: new Date(), lastError: String((error as Error)?.message ?? error).slice(0, 200) } },
  );
}

/** Compare both services before compensating: a lost MongoDB reply may hide a committed Errand. */
export async function reconcileCreation(
  creation: Pick<OrderCreationDocument, "_id" | "requesterId" | "amount">,
  leaseId?: string,
): Promise<ErrandRecord | null> {
  const orderId = creation._id.toString();
  const input = { orderId, requesterId: creation.requesterId, amount: creation.amount };
  const errand = await Errand.findById(creation._id) as ErrandRecord | null;
  const status = await inspectReservation(orderId);

  if (status.state !== "NOT_RESERVED" && !reservationMatches(status, input)) {
    throw new CreditRecoveryRequiredError();
  }
  if (errand) {
    const validCreditState = status.state === "RESERVED" ||
      (errand.status === "CANCELLED" || errand.status === "EXPIRED") && status.state === "REFUNDED" ||
      errand.status === "COMPLETED" && status.state === "TRANSFERRED";
    if (!validCreditState) throw new CreditRecoveryRequiredError();
    await updateCreation(orderId, "COMPLETED", leaseId);
    return errand;
  }
  if (status.state === "RESERVED") await releaseReservation(input);
  else if (status.state === "TRANSFERRED") throw new CreditRecoveryRequiredError();
  await updateCreation(orderId, "COMPENSATED", leaseId);
  return null;
}

/** One bounded, leased work item per call; the lifecycle sweep invokes this in batches. */
export async function reconcileOnePendingCreation(now = new Date()): Promise<boolean> {
  const leaseId = randomUUID();
  const creation = await OrderCreation.findOneAndUpdate(
    {
      state: "PENDING", retryAt: { $lte: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    },
    { $set: { leaseId, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
    { new: true, sort: { retryAt: 1 } },
  );
  if (!creation) return false;
  try {
    await reconcileCreation(creation, leaseId);
  } catch (error) {
    if (error instanceof CreditRecoveryRequiredError) {
      await updateCreation(creation._id.toString(), "RECONCILE", leaseId, {
        lastError: error.message,
      });
      console.error(`Order ${creation._id} needs manual Credit reconciliation`);
      return true;
    }
    const attempts = (creation.retryAttempts ?? 0) + 1;
    await OrderCreation.updateOne(
      { _id: creation._id, state: "PENDING", leaseId },
      {
        $set: {
          retryAttempts: attempts,
          retryAt: new Date(Date.now() + nextCreationRetryDelay(attempts)),
          lastError: String((error as Error)?.message ?? error).slice(0, 200),
        },
        $unset: { leaseId: "", leaseUntil: "" },
      },
    );
    console.warn(`Order creation recovery delayed for ${creation._id}; attempt ${attempts}`);
  }
  return true;
}
