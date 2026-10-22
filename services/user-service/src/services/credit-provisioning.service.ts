import { randomUUID } from "node:crypto";
import { User } from "../models/User.js";
import { syncCreditAccount } from "./credit-account.client.js";

const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;
const LEASE_MS = 30_000;
const POLL_MS = 5_000;

export function nextCreditRetryDelay(attempts: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.min(attempts - 1, 16));
}

export function initialCreditRetryAt(now = new Date()): Date {
  return new Date(now.getTime() + FIRST_RETRY_MS);
}

export async function recordCreditSetupFailure(userId: string, attempts: number, leaseId?: string): Promise<void> {
  await User.updateOne(
    { _id: userId, creditSetupPending: true, ...(leaseId ? { creditSetupLeaseId: leaseId } : {}) },
    {
      $set: {
        creditSetupAttempts: attempts,
        creditSetupNextRetryAt: new Date(Date.now() + nextCreditRetryDelay(attempts)),
      },
      $unset: { creditSetupLeaseId: "", creditSetupLeaseUntil: "" },
    },
  );
  console.warn(`Credit provisioning pending for user ${userId}; attempt ${attempts}`);
}

export async function markCreditSetupReady(userId: string, leaseId?: string): Promise<void> {
  await User.updateOne(
    { _id: userId, creditSetupPending: true, ...(leaseId ? { creditSetupLeaseId: leaseId } : {}) },
    {
      $set: { creditSetupPending: false, creditSetupAttempts: 0 },
      $unset: { creditSetupNextRetryAt: "", creditSetupLeaseId: "", creditSetupLeaseUntil: "" },
    },
  );
}

/** Claim one durable retry at a time; a crash releases the claim when its lease expires. */
export async function retryOneCreditAccount(now = new Date()): Promise<boolean> {
  const leaseId = randomUUID();
  const user = await User.findOneAndUpdate(
    {
      creditSetupPending: true,
      creditSetupNextRetryAt: { $lte: now },
      $or: [
        { creditSetupLeaseUntil: { $exists: false } },
        { creditSetupLeaseUntil: { $lte: now } },
      ],
    },
    { $set: { creditSetupLeaseId: leaseId, creditSetupLeaseUntil: new Date(now.getTime() + LEASE_MS) } },
    { new: true, sort: { creditSetupNextRetryAt: 1 } },
  );
  if (!user) return false;

  try {
    await syncCreditAccount(user._id.toString(), user.isActive !== false);
    await markCreditSetupReady(user._id.toString(), leaseId);
  } catch (error) {
    await recordCreditSetupFailure(user._id.toString(), (user.creditSetupAttempts ?? 0) + 1, leaseId);
    console.warn(`Credit provisioning retry failed for user ${user._id}:`, (error as Error).message);
  }
  return true;
}

export function startCreditProvisioningWorker(): () => Promise<void> {
  let running: Promise<void> | undefined;
  const tick = () => {
    if (running) return;
    running = (async () => {
      for (let count = 0; count < 20 && await retryOneCreditAccount(); count++) { /* bounded batch */ }
    })()
      .catch((error) => console.error("Credit provisioning worker failed:", error))
      .finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, POLL_MS);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
