import { createApp } from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { errandPath, reviewPath, settings } from "./config/settings.js";
import { startStatusConsumer } from "./event/rabbit.consumer.js";
import { authorizationStore } from "./security/authorization-state.js";
import { LiveHub } from "./services/live-hub.js";
import { MongoNotificationStore, MongoSubscriptionStore } from "./services/mongo-store.js";
import { createPushGateway, PushDispatcher } from "./services/push.service.js";

const port = Number(process.env.PORT ?? 3005);
let closeConsumer: (() => Promise<void>) | undefined;

async function main(): Promise<void> {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET missing");

  await connectDb();
  await authorizationStore.connect();

  const notifications = new MongoNotificationStore();
  const subscriptions = new MongoSubscriptionStore();
  const hub = new LiveHub();
  const push = new PushDispatcher(subscriptions, createPushGateway());
  if (!push.enabled) console.warn("Web Push is DISABLED (PUSH_DISABLED=true): only SSE and the inbox will work");

  // Start consuming only after the HTTP dependencies exist, so no event can arrive half-wired.
  closeConsumer = await startStatusConsumer({
    notifications,
    hub,
    push,
    rules: { directActions: settings.directActions, reviewPath},
    errandPath: (id) => settings.appErrandPath.replace("{id}", id),
  });

  const app = createApp({ notifications, subscriptions, hub, pushEnabled: push.enabled });
  const server = app.listen(port, "0.0.0.0", () => console.log(`Notification service listening on port ${port}`));

  const shutdown = async () => {
    // server.close() waits for open connections, and SSE streams never end on their own
    hub.closeAll();
    server.close(async () => {
      await closeConsumer?.();
      await disconnectDb();
      await authorizationStore.close();
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(async (error) => {
  console.error("Notification Service failed to start:", error);
  await closeConsumer?.();
  await disconnectDb();
  await authorizationStore.close();
  process.exitCode = 1;
});
