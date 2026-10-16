import { jwtVerify } from "jose";

export const ACCOUNT_TYPES = ["USER", "ADMIN", "SUPERADMIN"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccessTokenClaims {
  userId: string;
  role: AccountType;
  authzVersion: number;
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");

  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string" || !/^[0-9a-fA-F]{24}$/.test(payload.sub)) {
    throw new Error("JWT subject is missing or invalid");
  }
  if (!ACCOUNT_TYPES.includes(payload.role as AccountType)) {
    throw new Error("JWT role is missing or invalid");
  }
  if (!Number.isSafeInteger(payload.authzVersion) || (payload.authzVersion as number) < 0) {
    throw new Error("JWT authorization version is missing or invalid");
  }
  return {
    userId: payload.sub,
    role: payload.role as AccountType,
    authzVersion: payload.authzVersion as number,
  };
}
