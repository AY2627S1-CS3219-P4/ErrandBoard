import { createHmac, randomBytes } from "node:crypto";
import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { User } from "../models/User.js";

const RESEND_INTERVAL_MS = 60_000;
const RESEND_WINDOW_MS = 24 * 60 * 60_000;
const MAX_RESENDS = 10;

export const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? "ap-southeast-1" });

function config() {
  const poolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_APP_CLIENT_ID;
  const clientSecret = process.env.COGNITO_APP_CLIENT_SECRET;
  if (!poolId || !clientId || !clientSecret) throw new Error("Cognito verification is not configured");
  return { poolId, clientId, clientSecret };
}

function secretHash(email: string, clientId: string, secret: string): string {
  return createHmac("sha256", secret).update(email + clientId).digest("base64");
}

function isAwsError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}

async function persistSub(email: string, sub: string): Promise<void> {
  const result = await User.updateOne(
    { email, emailVerified: false, $or: [{ cognitoVerificationSub: { $exists: false } }, { cognitoVerificationSub: sub }] },
    { $set: { cognitoVerificationSub: sub } },
  );
  if (result.matchedCount !== 1) throw new Error("Could not associate Cognito confirmation with pending account");
}

async function signUpOrResend(email: string): Promise<void> {
  const { poolId, clientId, clientSecret } = config();
  const hash = secretHash(email, clientId, clientSecret);
  try {
    const response = await cognitoClient.send(new SignUpCommand({
      ClientId: clientId,
      Username: email,
      Password: `${randomBytes(32).toString("base64url")}aA1!`,
      SecretHash: hash,
      UserAttributes: [{ Name: "email", Value: email }],
    }));
    if (!response.UserSub || response.UserConfirmed) throw new Error("Cognito did not create a pending user");
    await persistSub(email, response.UserSub);
  } catch (error) {
    if (!isAwsError(error, "UsernameExistsException")) throw error;
    const existing = await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
    const sub = existing.UserAttributes?.find((attribute) => attribute.Name === "sub")?.Value;
    const attributes = Object.fromEntries((existing.UserAttributes ?? []).map(({ Name, Value }) => [Name, Value]));
    if (!sub || attributes.email?.toLowerCase() !== email) throw new Error("Existing Cognito user does not match pending account");
    if (existing.UserStatus === "CONFIRMED" && attributes.email_verified === "true") {
      await persistSub(email, sub);
      await completeCognitoVerification(poolId, sub);
      return;
    }
    if (existing.UserStatus !== "UNCONFIRMED") throw new Error("Existing Cognito user is not pending confirmation");
    await persistSub(email, sub);
    await cognitoClient.send(new ResendConfirmationCodeCommand({ ClientId: clientId, Username: email, SecretHash: hash }));
  }
}

export async function requestCognitoVerification(email: string, kind: "initial" | "resend" = "resend"): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const now = new Date();
  const filter = {
    email: normalized,
    emailVerified: false,
    $or: [
      { emailVerificationRequestedAt: { $exists: false } },
      { emailVerificationRequestedAt: { $lte: new Date(now.getTime() - RESEND_INTERVAL_MS) } },
    ],
    ...(kind === "resend" ? { $expr: { $lt: [{ $size: { $filter: {
      input: { $ifNull: ["$emailVerificationResendAttempts", []] },
      as: "attempt",
      cond: { $gt: ["$$attempt", new Date(now.getTime() - RESEND_WINDOW_MS)] },
    } } }, MAX_RESENDS] } } : {}),
  };
  const user = await User.findOneAndUpdate(
    filter,
    { $set: { emailVerificationRequestedAt: now }, ...(kind === "resend" ? { $push: {
      emailVerificationResendAttempts: { $each: [now], $slice: -MAX_RESENDS },
    } } : {}) },
    { returnDocument: "after" },
  ).select("+cognitoVerificationSub");
  if (!user) return false;
  try {
    if (user.cognitoVerificationSub) {
      const { poolId, clientId, clientSecret } = config();
      const existing = await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: normalized }));
      if (existing.UserStatus === "CONFIRMED") {
        await completeCognitoVerification(poolId, user.cognitoVerificationSub);
      } else if (existing.UserStatus === "UNCONFIRMED") {
        await cognitoClient.send(new ResendConfirmationCodeCommand({
          ClientId: clientId,
          Username: normalized,
          SecretHash: secretHash(normalized, clientId, clientSecret),
        }));
      } else {
        throw new Error("Existing Cognito user is not pending confirmation");
      }
    } else {
      await signUpOrResend(normalized);
    }
  } catch (error) {
    await User.updateOne(
      { _id: user._id, emailVerificationRequestedAt: now },
      { $unset: { emailVerificationRequestedAt: "" }, ...(kind === "resend" ? { $pull: { emailVerificationResendAttempts: now } } : {}) },
    );
    throw error;
  }
  return true;
}

export async function completeCognitoVerification(poolId: string, sub: string): Promise<boolean> {
  const { poolId: expectedPoolId } = config();
  if (poolId !== expectedPoolId || !/^[0-9a-f-]{36}$/i.test(sub)) throw new Error("Unexpected Cognito confirmation identity");
  const user = await User.findOne({ cognitoVerificationSub: sub }).select("+cognitoVerificationSub");
  if (!user) throw new Error("Cognito confirmation has no matching ErrandBoard account");
  let cognitoUser;
  try {
    cognitoUser = await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: user.email }));
  } catch (error) {
    if (isAwsError(error, "UserNotFoundException") && user.emailVerified) {
      return true;
    }
    throw error;
  }
  const attributes = Object.fromEntries((cognitoUser.UserAttributes ?? []).map(({ Name, Value }) => [Name, Value]));
  if (attributes.sub !== sub || attributes.email?.toLowerCase() !== user.email ||
      attributes.email_verified !== "true" || cognitoUser.UserStatus !== "CONFIRMED") {
    throw new Error("Cognito account is not confirmed with the matching verified email");
  }
  if (!user.emailVerified) {
    const result = await User.updateOne(
      { _id: user._id, cognitoVerificationSub: sub, emailVerified: false },
      { $set: { emailVerified: true }, $unset: {
        emailVerificationRequestedAt: "", emailVerificationResendAttempts: "",
      } },
    );
    if (result.matchedCount !== 1) throw new Error("Could not mark matching ErrandBoard account verified");
  }
  await cognitoClient.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: user.email }));
  return true;
}

export async function reconcileCognitoVerification(email: string): Promise<void> {
  const user = await User.findOne({ email, emailVerified: false }).select("+cognitoVerificationSub");
  if (!user?.cognitoVerificationSub) return;
  const { poolId } = config();
  try {
    await completeCognitoVerification(poolId, user.cognitoVerificationSub);
  } catch (error) {
    if (isAwsError(error, "UserNotFoundException")) return;
    if (error instanceof Error && error.message === "Cognito account is not confirmed with the matching verified email") return;
    throw error;
  }
}
