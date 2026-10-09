import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDb, disconnectDb } from "../db.js";
import { User } from "../models/User.js";
import { syncCreditAccount } from "../services/credit-account.client.js";

// Run once after deploying Credit Service to provision accounts for Users that
// existed before registration and seeding started calling it.
export async function backfillUserCredits(): Promise<number> {
  let count = 0;
  const pending: Promise<void>[] = [];
  for await (const user of User.find().select("_id isActive").lean().cursor()) {
    pending.push(syncCreditAccount(user._id.toString(), user.isActive !== false));
    if (pending.length === 10) {
      const results = await Promise.allSettled(pending);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      count += pending.length;
      pending.length = 0;
    }
  }
  const results = await Promise.allSettled(pending);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  count += pending.length;
  return count;
}

async function main(): Promise<void> {
  await connectDb();
  try {
    const count = await backfillUserCredits();
    console.log(`Credit accounts synchronized for ${count} users`);
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Credit backfill failed:", error);
    process.exitCode = 1;
  });
}
