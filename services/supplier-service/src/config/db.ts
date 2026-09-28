import mongoose from "mongoose";

//listeners for database connection events

//Listens for error events when connecting to database
mongoose.connection.on("error", () => {
    console.error("MongoDB connection error");
});

//Listens for disconnection events when connecting to database
mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected");
});


export async function connectDb(): Promise<void> {
    const pw = process.env.MONGO_SUPPLIER_SERVICE_PASSWORD;

    if (!pw) {
        throw new Error("MONGO_SUPPLIER_SERVICE_PASSWORD missing");
    }

    const host = process.env.MONGO_HOST ?? "127.0.0.1";
    const db = process.env.MONGO_DB_NAME ?? "errandboard";

    await mongoose.connect(`mongodb://${host}:27017/${db}`, {
        user: "supplier_service",
        pass: pw,
        authSource: db,
        serverSelectionTimeoutMS: 5000,
        autoCreate: false,
        autoIndex: false,
        bufferCommands: false,
    });
}

export async function disconnectDb(): Promise<void> {
    await mongoose.disconnect();
}

