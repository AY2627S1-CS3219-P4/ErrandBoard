import { connectDb, disconnectDb } from "../db.js";
import { authorizationStore } from "../security/authorization-state.js";

async function main(): Promise<void> {
  if (process.env.AUTHZ_RECOVERY_CONFIRM !== "I_STOPPED_USER_SERVICE_WRITES") {
    throw new Error("Stop User Service writes, then set AUTHZ_RECOVERY_CONFIRM=I_STOPPED_USER_SERVICE_WRITES");
  }
  await connectDb();
  await authorizationStore.connect();
  await authorizationStore.reconcile();
  console.log("Redis authorization state rebuilt from MongoDB");
}

main()
  .catch((error) => { console.error("Authorization recovery failed:", error); process.exitCode = 1; })
  .finally(async () => {
    await authorizationStore.close();
    await disconnectDb();
  });
