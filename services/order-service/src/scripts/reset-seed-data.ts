import mongoose from "mongoose";
import { createClient } from "redis";
import amqp from "amqplib";

const collections = ["users", "sessions", "suppliers", "items", "inventory", "errands", "orderCreation", "UserCredits", "transactionLog"];
const queues = ["credit.errand.events", "credit.errand.events.retry", "credit.errand.events.dead"];

async function main(): Promise<void> {
  if (process.env.RESET_CONFIRM !== "WIPE_ERRANDBOARD_AND_SEED") throw new Error("Reset confirmation missing");
  const password = process.env.MONGO_ROOT_PASSWORD;
  const host = process.env.MONGO_HOST;
  const redisUrl = process.env.REDIS_URL;
  const rabbitUrl = process.env.RABBITMQ_URL;
  if (!password || !host || !redisUrl || !rabbitUrl) throw new Error("Reset dependency configuration missing");

  // Connect to every dependency before making the first destructive change.
  await mongoose.connect(`mongodb://${host}:27017/errandboard`, {
    user: "admin", pass: password, authSource: "admin", serverSelectionTimeoutMS: 5000,
  });
  const redis = createClient({ url: redisUrl });
  const rabbit = await amqp.connect(rabbitUrl);
  try {
    await redis.connect();
    for (const queue of queues) {
      const channel = await rabbit.createChannel();
      try {
        await channel.deleteQueue(queue);
      } catch (error) {
        const reply = error as { code?: number; replyCode?: number };
        if (reply.code !== 404 && reply.replyCode !== 404) throw error;
      } finally {
        await channel.close().catch(() => {});
      }
    }
    {
      const db = mongoose.connection.db;
      if (!db) throw new Error("MongoDB database unavailable");
      const existing = new Set((await db.listCollections().toArray()).map((collection) => collection.name));
      for (const name of collections) {
        if (existing.has(name)) await db.collection(name).deleteMany({});
      }
      await redis.flushDb();
      console.log("Cleared application MongoDB collections, Redis database, and credit event queues");
    }
  } finally {
    await rabbit.close();
    if (redis.isOpen) await redis.quit();
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error("Reset failed:", error); process.exitCode = 1; });
