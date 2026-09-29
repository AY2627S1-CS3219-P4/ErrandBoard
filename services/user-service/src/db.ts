import mongoose from 'mongoose';
import { Session } from './models/Session.js';

mongoose.connection.on("error", () => {
    console.error("MongoDB connection error");
});

mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected");
});

export async function connectDb(): Promise<void> {
    const pw = process.env.MONGO_USER_SERVICE_PASSWORD;

    if (!pw) {
        throw new Error("MONGO_USER_SERVICE_PASSWORD missing");
    }

    const host = process.env.MONGO_HOST ?? "127.0.0.1";
    const db = process.env.MONGO_DB_NAME ?? "errandboard";

    await mongoose.connect(`mongodb://${host}:27017/${db}`, {
        user: "user_service",
        pass: pw,
        authSource: db,
        serverSelectionTimeoutMS: 5000,
        autoCreate: false,
        autoIndex: false,
        bufferCommands: false,
    });

    // Ensure the Session model's indexes, including the expiresAt TTL index,
    // exist even though automatic connection-wide index creation is disabled.
    await Session.createIndexes();
}

export async function disconnectDb(): Promise<void> {
    await mongoose.disconnect();
}
