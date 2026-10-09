import { Types } from "mongoose";
import { UserCredit } from "../models/UserCredit.js";

/** Create a credit account if needed and mirror account status without resetting balances. */
export async function ensureCreditAccount(userId: Types.ObjectId, isActive = true): Promise<void> {
  try {
    await UserCredit.updateOne(
      { userId },
      {
        $set: { isActive },
        $setOnInsert: {
          userId,
          available: 100,
          reserve: 0,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // A concurrent request may win the unique-index race. Apply this caller's
    // status to the winning document without changing its balance.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      const result = await UserCredit.updateOne({ userId }, { $set: { isActive } });
      if (result.matchedCount === 1) return;
    }
    throw error;
  }
}
