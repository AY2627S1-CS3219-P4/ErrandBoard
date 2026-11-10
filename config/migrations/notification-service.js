// Run as a MongoDB administrator against an existing errandboard volume.
// Fresh volumes use config/db.js instead.
// Needs MONGO_NOTIFICATION_SERVICE_PASSWORD set in the MongoDB container (see compose.yaml).
const notificationDb = db.getSiblingDB("errandboard");
const notificationPassword = process.env.MONGO_NOTIFICATION_SERVICE_PASSWORD;
if (!notificationPassword) {
  throw new Error("MONGO_NOTIFICATION_SERVICE_PASSWORD must be set in the MongoDB container");
}

const notificationPrivileges = [
  // no "remove": old notifications expire through the TTL index, which mongod runs itself
  {
    resource: { db: "errandboard", collection: "notifications" },
    actions: ["find", "insert", "update"],
  },
  {
    resource: { db: "errandboard", collection: "pushSubscriptions" },
    actions: ["find", "insert", "update", "remove"],
  },
];

if (notificationDb.getRole("notification_service_role")) {
  notificationDb.updateRole("notification_service_role", { privileges: notificationPrivileges, roles: [] });
} else {
  notificationDb.createRole({
    role: "notification_service_role",
    privileges: notificationPrivileges,
    roles: [],
  });
}

if (notificationDb.getUser("notification_service")) {
  notificationDb.updateUser("notification_service", {
    roles: [{ role: "notification_service_role", db: "errandboard" }],
  });
} else {
  notificationDb.createUser({
    user: "notification_service",
    pwd: notificationPassword,
    roles: [{ role: "notification_service_role", db: "errandboard" }],
  });
}

// Index definitions deliberately omit `name`, exactly like config/db.js, so MongoDB's default names
// match and this migration is a no-op on any volume that db.js already initialised.
if (!notificationDb.getCollectionInfos({ name: "notifications" }).length) {
  notificationDb.createCollection("notifications");
}
// (userId, eventId) is the idempotency key for at-least-once event delivery
notificationDb.notifications.createIndex({ userId: 1, eventId: 1 }, { unique: true });
notificationDb.notifications.createIndex({ userId: 1, _id: -1 });
notificationDb.notifications.createIndex({ userId: 1, readAt: 1 });
// Inbox history is kept 90 days. Keep in sync with services/notification-service/src/models/Notification.ts
notificationDb.notifications.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

if (!notificationDb.getCollectionInfos({ name: "pushSubscriptions" }).length) {
  notificationDb.createCollection("pushSubscriptions");
}
notificationDb.pushSubscriptions.createIndex({ endpoint: 1 }, { unique: true });
notificationDb.pushSubscriptions.createIndex({ userId: 1 });