//Main entry point
import { app } from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { getEventPublisher, closeEventPublisher } from "./event/publisher.js";
import { authorizationStore } from "./security/authorization-state.js";

const port = Number(process.env.PORT ?? 3003);

async function main(): Promise<void> {
    await connectDb();
    await authorizationStore.connect();

    getEventPublisher(); // opens the connection and declares the exchange

    //have the express app listen
    const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Order service listening on port ${port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await disconnectDb();
      await authorizationStore.close();
      await closeEventPublisher();
      process.exitCode = 0;
    });
  };
  
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(async (error) => {
  console.error("Order Service failed to start:", error);
  await disconnectDb();
  await authorizationStore.close();
  process.exitCode = 1;
});