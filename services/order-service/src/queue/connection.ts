import { Redis } from "ioredis";

export const bullConnection = new Redis(
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  { maxRetriesPerRequest: null }
);

bullConnection.on("error", (e) => console.error("BullMQ Redis error:", e.message));
