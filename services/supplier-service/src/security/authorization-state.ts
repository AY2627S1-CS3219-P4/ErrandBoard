import { createClient } from "redis";
import type { AccessTokenClaims } from "../types/auth.types.js";

export type AuthorizationDecision = "allowed" | "inactive" | "revoked" | "unavailable";

export function decideAuthorization(state: unknown, claims: AccessTokenClaims): AuthorizationDecision {
  if (!state || typeof state !== "object") return "unavailable";
  const { version, role, active, blocked } = state as Record<string, unknown>;
  if (!Number.isSafeInteger(version) || typeof role !== "string" ||
      typeof active !== "boolean" || typeof blocked !== "boolean") return "unavailable";
  if (blocked) return "revoked";
  if (!active) return "inactive";
  if (version !== claims.authzVersion || role !== claims.role) return "revoked";
  return "allowed";
}

const client = createClient({
  url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  disableOfflineQueue: true,
  socket: { connectTimeout: 2000 },
});
client.on("error", (error) => console.error("Redis authorization connection error:", error));

export const authorizationStore = {
  async connect(): Promise<void> {
    if (!client.isOpen) await client.connect();
  },
  async close(): Promise<void> {
    if (client.isOpen) await client.quit();
  },
  async check(claims: AccessTokenClaims): Promise<AuthorizationDecision> {
    try {
      const raw = await client.get(`authz:user:${claims.userId}`);
      if (!raw) return "unavailable";
      return decideAuthorization(JSON.parse(raw), claims);
    } catch {
      return "unavailable";
    }
  },
};
