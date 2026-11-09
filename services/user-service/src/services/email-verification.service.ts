import { createHash, randomBytes } from "node:crypto";
import { User } from "../models/User.js";
import { verificationEmailSender } from "./verification-email.sender.js";

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestVerificationEmail(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(token);
  const now = new Date();
  const user = await User.findOneAndUpdate(
    {
      email: normalized,
      emailVerified: false,
      $or: [
        { emailVerificationRequestedAt: { $exists: false } },
        { emailVerificationRequestedAt: { $lte: new Date(now.getTime() - RESEND_INTERVAL_MS) } },
      ],
    },
    { $set: {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS),
      emailVerificationRequestedAt: now,
    } },
    { returnDocument: "after" },
  );
  if (!user) return false;

  try {
    await verificationEmailSender.send(user.email, token);
  } catch (error) {
    // Delivery may have succeeded despite a network error. Keep this token valid
    // until a resend replaces it, but allow an immediate retry.
    await User.updateOne(
      { _id: user._id, emailVerificationTokenHash: tokenHash },
      { $unset: { emailVerificationRequestedAt: "" } },
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
    } },
    { returnDocument: "after" },
  );
  return Boolean(user);
}
