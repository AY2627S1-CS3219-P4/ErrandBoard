import { jwtVerify } from "jose";
import { ACCOUNT_TYPES, type AccessTokenClaims, type AccountType } from "../types/auth.types.js";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return new TextEncoder().encode(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret());

  if (typeof payload.sub !== "string") {
    throw new Error("JWT subject is missing");
  }

  if (!ACCOUNT_TYPES.includes(payload.role as AccountType)) {
    throw new Error("JWT role is missing or invalid");
  }
  if (!Number.isSafeInteger(payload.authzVersion) || (payload.authzVersion as number) < 0) {
    throw new Error("JWT authorization version is missing or invalid");
  }

  return { userId: payload.sub, role: payload.role as AccountType, authzVersion: payload.authzVersion as number };
}
