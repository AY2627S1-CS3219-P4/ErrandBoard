import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDb, disconnectDb } from "../db.js";
import { User } from "../models/User.js";

export async function backfillEmailVerification(): Promise<number> {
  const result = await User.updateMany(
    { emailVerified: { $exists: false } },
    { $set: { emailVerified: true } },
  );
  return result.modifiedCount;
}

async function main(): Promise<void> {
  await connectDb();
  try {
    const count = await backfillEmailVerification();
    console.log(`Existing accounts marked verified: ${count}`);
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Email verification backfill failed:", error);
    process.exitCode = 1;
  });
}
