import { app } from "./app.js";
import { connectDb, disconnectDb } from "./db.js";

const port = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
    await connectDb();

    const server = app.listen(port, "0.0.0.0", () => {
        console.log(`User service listening on port ${port}`);
    });

    const shutdown = async () => {
        server.close(async () => {
            await disconnectDb();
            process.exitCode = 0;
        });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

main().catch(async (error) => {
    console.error("User Service failed to start:", error);
    await disconnectDb();
    process.exitCode = 1;
});
