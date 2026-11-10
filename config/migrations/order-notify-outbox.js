// Run as a MongoDB administrator on existing volumes after deploying the Order status-event
// outbox. Fresh volumes use config/db.js instead.
// Order's role already allows find/insert/update on errands; only this index is new. It keeps the
// lifecycle sweep's relay query ({ notifyPending: true }) from scanning the whole collection.
const orderDb = db.getSiblingDB("errandboard");
if (!orderDb.getRole("order_service_role")) {
  throw new Error("order_service_role is missing; initialise the database before this migration");
}
// No `name`, matching config/db.js, so this is a no-op where db.js already created it.
orderDb.errands.createIndex({ notifyPending: 1 }, { partialFilterExpression: { notifyPending: true } });
