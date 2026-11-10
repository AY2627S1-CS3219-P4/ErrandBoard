import { Redis } from "ioredis";
import { logger } from "../logger.js";

export const bullConnection = new Redis(
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  { maxRetriesPerRequest: null }
);

bullConnection.on("error", (e) => logger.error({ err: e }, "BullMQ Redis error"));
