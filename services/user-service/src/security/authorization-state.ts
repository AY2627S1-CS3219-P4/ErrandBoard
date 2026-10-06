import { createClient } from "redis";
import { User, type AccountType } from "../models/User.js";

export interface AuthorizationState {
  version: number;
  role: AccountType;
  active: boolean;
  blocked: boolean;
}

export type AuthorizationDecision = "allowed" | "inactive" | "revoked" | "unavailable";

export class AuthorizationStateError extends Error {
  constructor() { super("Authorization temporarily unavailable. Please retry later."); }
}

const key = (userId: string) => `authz:user:${userId}`;
const client = createClient({
  url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  disableOfflineQueue: true,
  socket: { connectTimeout: 2000 },
});
client.on("error", (error) => console.error("Redis authorization connection error:", error));

const compareAndSet = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
`;

function stateFor(user: { accountType: AccountType; isActive: boolean; authzVersion?: number }): AuthorizationState {
  return {
    version: user.authzVersion ?? 0,
    role: user.accountType,
    active: user.isActive !== false,
    blocked: false,
  };
}

export const authorizationStore = {
  async connect(): Promise<void> {
    if (!client.isOpen) await client.connect();
  },
  async close(): Promise<void> {
    if (client.isOpen) await client.quit();
  },
  async read(userId: string): Promise<AuthorizationState | null> {
    const raw = await client.get(key(userId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const state = value as AuthorizationState;
    if (!Number.isSafeInteger(state.version) || state.version < 0 ||
        !["USER", "ADMIN", "SUPERADMIN"].includes(state.role) ||
        typeof state.active !== "boolean" || typeof state.blocked !== "boolean") return null;
    return state;
  },
  async initialize(userId: string, user: { accountType: AccountType; isActive: boolean; authzVersion?: number }): Promise<void> {
    await client.set(key(userId), JSON.stringify(stateFor(user)), { NX: true });
  },
  async block(userId: string, user: { accountType: AccountType; isActive: boolean; authzVersion?: number }): Promise<AuthorizationState> {
    const previous = stateFor(user);
    const changed = await client.eval(compareAndSet, {
      keys: [key(userId)],
      arguments: [JSON.stringify(previous), JSON.stringify({ ...previous, blocked: true })],
    });
    if (changed !== 1) throw new Error("Authorization state changed or is unavailable");
    return previous;
  },
  async publish(userId: string, previous: AuthorizationState, updated: { accountType: AccountType; isActive: boolean; authzVersion?: number }): Promise<void> {
    const changed = await client.eval(compareAndSet, {
      keys: [key(userId)],
      arguments: [JSON.stringify({ ...previous, blocked: true }), JSON.stringify(stateFor(updated))],
    });
    if (changed !== 1) throw new Error("Authorization state could not be published");
  },
  async restore(userId: string, previous: AuthorizationState): Promise<void> {
    const changed = await client.eval(compareAndSet, {
      keys: [key(userId)],
      arguments: [JSON.stringify({ ...previous, blocked: true }), JSON.stringify(previous)],
    });
    if (changed !== 1) throw new Error("Authorization state could not be restored");
  },
  async bootstrap(): Promise<void> {
    const users = await User.find().select("_id accountType isActive authzVersion").lean();
    for (const user of users) {
      await authorizationStore.initialize(user._id.toString(), user);
    }
  },
  // Operator recovery only. Run with User Service writes stopped: this can
  // replace a blocked transition after a crash with MongoDB's durable state.
  async reconcile(): Promise<void> {
    const users = await User.find().select("_id accountType isActive authzVersion").lean();
    const known = new Set(users.map((user) => key(user._id.toString())));
    for await (const keys of client.scanIterator({ MATCH: "authz:user:*", COUNT: 100 })) {
      for (const existingKey of keys) {
        if (!known.has(existingKey)) await client.del(existingKey);
      }
    }
    for (const user of users) {
      await client.set(key(user._id.toString()), JSON.stringify(stateFor(user)));
    }
  },
};

export async function checkAuthorization(
  userId: string, role: AccountType, version: number,
): Promise<AuthorizationDecision> {
  try {
    const current = await authorizationStore.read(userId);
    if (!current) return "unavailable";
    if (current.blocked) return "revoked";
    if (!current.active) return "inactive";
    if (current.version !== version || current.role !== role) return "revoked";
    return "allowed";
  } catch {
    return "unavailable";
  }
}

export async function requireCurrentAuthorization(user: {
  _id: { toString(): string };
  accountType: AccountType;
  authzVersion?: number;
}): Promise<boolean> {
  const decision = await checkAuthorization(user._id.toString(), user.accountType, user.authzVersion ?? 0);
  if (decision === "unavailable") throw new AuthorizationStateError();
  return decision === "allowed";
}
