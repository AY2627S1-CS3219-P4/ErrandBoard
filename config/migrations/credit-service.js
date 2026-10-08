// Run as a MongoDB administrator against an existing errandboard volume.
// Fresh volumes use config/db.js instead.
const creditDb = db.getSiblingDB("errandboard");
const creditPassword = process.env.MONGO_CREDIT_SERVICE_PASSWORD;
if (!creditPassword) {
  throw new Error("MONGO_CREDIT_SERVICE_PASSWORD must be set in the MongoDB container");
}

const creditPrivileges = [
  {
    resource: { db: "errandboard", collection: "UserCredits" },
    actions: ["find", "insert", "update"],
  },
  {
    resource: { db: "errandboard", collection: "transactionLog" },
    actions: ["find", "insert"],
  },
];

if (creditDb.getRole("credit_service_role")) {
  creditDb.updateRole("credit_service_role", { privileges: creditPrivileges, roles: [] });
} else {
  creditDb.createRole({
    role: "credit_service_role",
    privileges: creditPrivileges,
    roles: [],
  });
}

if (creditDb.getUser("credit_service")) {
  creditDb.updateUser("credit_service", {
    roles: [{ role: "credit_service_role", db: "errandboard" }],
  });
} else {
  creditDb.createUser({
    user: "credit_service",
    pwd: creditPassword,
    roles: [{ role: "credit_service_role", db: "errandboard" }],
  });
}

if (!creditDb.getCollectionInfos({ name: "UserCredits" }).length) {
  creditDb.createCollection("UserCredits");
}

// An early credit-service model declared a non-unique userId index. MongoDB
// cannot change that index to unique in place, so replace it after checking
// that existing data can satisfy the new constraint.
const userIdIndex = creditDb.UserCredits.getIndexes().find(
  (index) => index.name === "userId_1",
);
if (userIdIndex && !userIdIndex.unique) {
  if (userIdIndex.key.userId !== 1 || Object.keys(userIdIndex.key).length !== 1) {
    throw new Error("Unexpected userId_1 index definition; inspect it manually");
  }
  const duplicate = creditDb.UserCredits.aggregate([
    { $group: { _id: "$userId", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).toArray()[0];
  if (duplicate) {
    throw new Error("Duplicate UserCredits.userId values must be resolved before creating the unique index");
  }
  creditDb.UserCredits.dropIndex("userId_1");
}
creditDb.UserCredits.createIndex({ userId: 1 }, { unique: true });

if (!creditDb.getCollectionInfos({ name: "transactionLog" }).length) {
  creditDb.createCollection("transactionLog");
}
creditDb.transactionLog.createIndex({ orderId: 1 });
