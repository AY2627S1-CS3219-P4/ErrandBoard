import { app } from "./app.js";
import { connectDb, disconnectDb } from "./db.js";
import { authorizationStore } from "./security/authorization-state.js";
import { startErrandConsumer } from "./event/rabbit.consumer.js";

const port = Number(process.env.PORT ?? 3004);
let closeErrandConsumer: (() => Promise<void>) | undefined;

async function main(): Promise<void> {
    if (!process.env.CREDIT_INTERNAL_API_KEY) {
        throw new Error("CREDIT_INTERNAL_API_KEY missing");
    }
    if (!process.env.ORDER_CREDIT_API_KEY) {
        throw new Error("ORDER_CREDIT_API_KEY missing");
    }
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET missing");
    }
    await connectDb();
    await authorizationStore.connect();
    closeErrandConsumer = await startErrandConsumer();

    const server = app.listen(port, "0.0.0.0", () => {
        console.log(`Credit service listening on port ${port}`);
    });

    const shutdown = async () => {
        server.close(async () => {
            await closeErrandConsumer?.();
            await disconnectDb();
            await authorizationStore.close();
            process.exitCode = 0;
        });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

main().catch(async (error) => {
    console.error("Credit Service failed to start:", error);
    await closeErrandConsumer?.();
    await disconnectDb();
    await authorizationStore.close();
    process.exitCode = 1;
});
