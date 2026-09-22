import mongoose from 'mongoose';

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

    await mongoose.connect(`mongodb://${host}:27017/errandboard`, {
        user: "user_service",
        pass: pw,
        authSource: "errandboard",
        serverSelectionTimeoutMS: 5000,
        autoCreate: false,
        autoIndex: false,
        bufferCommands: false,
    });
}

export async function disconnectDb(): Promise<void> {
    await mongoose.disconnect();
}
