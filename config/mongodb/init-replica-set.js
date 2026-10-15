const adminDb = db.getSiblingDB("admin");
if (!adminDb.auth("admin", process.env.MONGO_ROOT_PASSWORD)) {
  throw new Error("Replica-set initialization could not authenticate as MongoDB admin");
}

let needsInitiation = false;
try {
  const status = adminDb.runCommand({ replSetGetStatus: 1 });
  if (status.ok !== 1) {
    if (status.code !== 94) throw new Error(status.errmsg || "Replica-set status failed");
    needsInitiation = true;
  }
} catch (error) {
  if (error.code !== 94 && error.codeName !== "NotYetInitialized") throw error;
  needsInitiation = true;
}
if (needsInitiation) {
  const result = adminDb.runCommand({
    replSetInitiate: {
      _id: "rs0",
      members: [{ _id: 0, host: "mongodb:27017" }],
    },
  });
  if (result.ok !== 1) throw new Error(result.errmsg || "Replica-set initiation failed");
}

let primary = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  if (adminDb.runCommand({ hello: 1 }).isWritablePrimary) {
    primary = true;
    break;
  }
  sleep(1000);
}
if (!primary) throw new Error("MongoDB did not become primary");
