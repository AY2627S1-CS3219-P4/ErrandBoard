import { SignJWT, jwtVerify } from "jose";
import { ACCOUNT_TYPES, type AccountType } from "../models/User.js";

interface AccessTokenClaims {
  userId: string;
  role: AccountType;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return new TextEncoder().encode(secret);
}

export async function createAccessToken(userId: string, role: AccountType): Promise<string> {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret());

  if (typeof payload.sub !== "string") {
    throw new Error("JWT subject is missing");
  }

  if (!ACCOUNT_TYPES.includes(payload.role as AccountType)) {
    throw new Error("JWT role is missing or invalid");
  }

  return { userId: payload.sub, role: payload.role as AccountType };
}