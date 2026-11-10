//Main entry point
import { app } from "./app.js";
import { logger } from "./logger.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { getEventPublisher, closeEventPublisher } from "./event/publisher.js";
import { startLifecycle, stopLifecycle } from "./queue/queue.js";
import { authorizationStore } from "./security/authorization-state.js";

const port = Number(process.env.PORT ?? 3003);

async function main(): Promise<void> {
    await connectDb();
    await authorizationStore.connect();

    getEventPublisher(); // opens the connection and declares the exchange
    await startLifecycle();

    //have the express app listen
    const server = app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Order service listening");
  });

  const shutdown = async () => {
    await stopLifecycle();
    server.close(async () => {
      await closeEventPublisher();
      await disconnectDb();
      await authorizationStore.close();
      process.exitCode = 0;
    });
  };
  
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(async (error) => {
  logger.error({ err: error }, "Order Service failed to start");
  await disconnectDb();
  await authorizationStore.close();
  process.exitCode = 1;
});