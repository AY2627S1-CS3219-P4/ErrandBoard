// Run as a MongoDB administrator on existing volumes after deploying the
// Order saga code. Fresh volumes use config/db.js instead.
const orderDb = db.getSiblingDB("errandboard");
const orderPrivileges = [
  { resource: { db: "errandboard", collection: "errands" }, actions: ["find", "insert", "update", "remove"] },
  { resource: { db: "errandboard", collection: "orderCreation" }, actions: ["find", "insert", "update", "remove"] },
];

if (!orderDb.getRole("order_service_role")) {
  throw new Error("order_service_role is missing; initialise the database before this migration");
}
orderDb.updateRole("order_service_role", { privileges: orderPrivileges, roles: [] });

if (!orderDb.getCollectionInfos({ name: "orderCreation" }).length) {
  orderDb.createCollection("orderCreation");
}
orderDb.orderCreation.createIndex(
  { state: 1, retryAt: 1 },
  { partialFilterExpression: { state: "PENDING" } },
);
