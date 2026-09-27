//Main entry point
import { app } from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";

//Note: User service -> defaults to 3001
const port = Number(process.env.PORT ?? 3002);

async function main(): Promise<void> {
    await connectDb();

    //have the express app listen
    const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Supplier service listening on port ${port}`);
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
  console.error("Supplier Service failed to start:", error);
  await disconnectDb();
  process.exitCode = 1;
});


