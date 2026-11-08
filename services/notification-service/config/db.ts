import mongoose from "mongoose";

mongoose.connection.on("error", () => console.error("MongoDB connection error"));
mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected"));

export async function connectDb(): Promise<void> {
  const pw = process.env.MONGO_NOTIFICATION_SERVICE_PASSWORD;
  if (!pw) throw new Error("MONGO_NOTIFICATION_SERVICE_PASSWORD missing");

  const host = process.env.MONGO_HOST ?? "127.0.0.1";
  const db = process.env.MONGO_DB_NAME ?? "errandboard";

  await mongoose.connect(`mongodb://${host}:27017/${db}`, {
    user: "notification_service",
    pass: pw,
    authSource: db,
    serverSelectionTimeoutMS: 5000,
    // Same posture as the other services: the running service has no createCollection/createIndex
    // rights. Collections and indexes come from migrations/notification-service.js.
    autoCreate: false,
    autoIndex: false,
    bufferCommands: false,
  });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
