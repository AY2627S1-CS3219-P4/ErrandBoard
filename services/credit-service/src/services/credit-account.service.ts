import { Types } from "mongoose";
import { UserCredit } from "../models/UserCredit.js";

/** Create the initial credit account once; never reset an existing balance. */
export async function ensureCreditAccount(userId: Types.ObjectId): Promise<void> {
  try {
    await UserCredit.updateOne(
      { userId },
      {
        $setOnInsert: {
          userId,
          available: 100,
          reserve: 0,
          isActive: true,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // A concurrent request may win the unique-index race. That is success
    // only if the requested account now exists.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000 &&
      (await UserCredit.exists({ userId }))
    ) {
      return;
    }
    throw error;
  }
}
