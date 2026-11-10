import { createHash, randomBytes } from "node:crypto";
import { User } from "../models/User.js";
import { verificationEmailQueue } from "./verification-email.queue.js";

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;
const RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RESENDS_PER_WINDOW = 10;

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestVerificationEmail(email: string, kind: "initial" | "resend" = "resend"): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(token);
  const now = new Date();
  const filter = {
      email: normalized,
      emailVerified: false,
      $or: [
        { emailVerificationRequestedAt: { $exists: false } },
        { emailVerificationRequestedAt: { $lte: new Date(now.getTime() - RESEND_INTERVAL_MS) } },
      ],
      ...(kind === "resend" ? { $expr: {
        $lt: [{ $size: { $filter: {
          input: { $ifNull: ["$emailVerificationResendAttempts", []] },
          as: "attempt",
          cond: { $gt: ["$$attempt", new Date(now.getTime() - RESEND_WINDOW_MS)] },
        } } }, MAX_RESENDS_PER_WINDOW],
      } } : {}),
    };
  const user = await User.findOneAndUpdate(
    filter,
    { $set: {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS),
      emailVerificationRequestedAt: now,
    }, $unset: { emailVerificationDeliveredTokenHash: "" }, ...(kind === "resend" ? { $push: {
      emailVerificationResendAttempts: { $each: [now], $slice: -MAX_RESENDS_PER_WINDOW },
    } } : {}) },
    { returnDocument: "after" },
  );
  if (!user) return false;

  try {
    await verificationEmailQueue.enqueue(user._id.toString(), token);
  } catch (error) {
    // The account remains unverified. A later resend may replace this token.
    await User.updateOne(
      { _id: user._id, emailVerificationTokenHash: tokenHash },
      { $unset: {
        emailVerificationRequestedAt: "",
        emailVerificationTokenHash: "",
        emailVerificationExpiresAt: "",
        emailVerificationDeliveredTokenHash: "",
      }, ...(kind === "resend" ? { $pull: { emailVerificationResendAttempts: now } } : {}) },
    );
    throw error;
  }
  return true;
}

export async function confirmVerificationToken(token: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const user = await User.findOneAndUpdate(
    {
      emailVerified: false,
      emailVerificationTokenHash: hashVerificationToken(token),
      emailVerificationExpiresAt: { $gt: new Date() },
    },
    { $set: { emailVerified: true }, $unset: {
      emailVerificationTokenHash: "",
      emailVerificationExpiresAt: "",
      emailVerificationRequestedAt: "",
      emailVerificationResendAttempts: "",
      emailVerificationDeliveredTokenHash: "",
    } },
    { returnDocument: "after" },
  );
  return Boolean(user);
}
