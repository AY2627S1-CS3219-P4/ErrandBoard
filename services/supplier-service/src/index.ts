//Main entry point
import { app } from "./app.js";
import { logger } from "./logger.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { authorizationStore } from "./security/authorization-state.js";

//Note: User service -> defaults to 3001
const port = Number(process.env.PORT ?? 3002);

async function main(): Promise<void> {
    await connectDb();
    await authorizationStore.connect();

    //have the express app listen
    const server = app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Supplier service listening");
  });

  const shutdown = async () => {
    server.close(async () => {
      await disconnectDb();
      await authorizationStore.close();
      process.exitCode = 0;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(async (error) => {
  logger.error({ err: error }, "Supplier Service failed to start");
  await disconnectDb();
  await authorizationStore.close();
  process.exitCode = 1;
});

