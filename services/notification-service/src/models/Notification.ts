import { model, Schema } from "mongoose";
import { NOTIFICATION_KINDS, type NotificationAction, type NotificationKind, type RecipientRole, type Urgency } from "../types/notification.types.js";

export interface NotificationDocument {
  userId: string;
  eventId: string; // `<errandId>:status:<STATUS>`; with userId this is the idempotency key
  errandId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
  recipientRole: RecipientRole;
  urgency: Urgency;
  actions: NotificationAction[];
  occurredAt: Date;
  readAt?: Date | null;
  fanoutAt?: Date | null; // set once live + push delivery was attempted; lets a redelivered event finish the job
  createdAt: Date;
  updatedAt: Date;
}

const actionSchema = new Schema<NotificationAction>(
  {
    action: { type: String, enum: ["view", "review", "confirm"], required: true },
    title: { type: String, required: true },
    request: { type: new Schema({ method: String, path: String }, { _id: false }), default: undefined },
  },
  { _id: false },
);

const notificationSchema = new Schema<NotificationDocument>(
  {
    userId: { type: String, required: true },
    eventId: { type: String, required: true },
    errandId: { type: String, required: true },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    url: { type: String, required: true },
    recipientRole: { type: String, enum: ["REQUESTER", "COURIER"], required: true },
    urgency: { type: String, enum: ["normal", "high"], required: true },
    actions: { type: [actionSchema], default: [] },
    occurredAt: { type: Date, required: true },
    readAt: { type: Date, default: null },
    fanoutAt: { type: Date, default: null },
  },
  { collection: "notifications", timestamps: true },
);

notificationSchema.index({ userId: 1, eventId: 1 }, { unique: true });
notificationSchema.index({ userId: 1, _id: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Notification = model<NotificationDocument>("Notification", notificationSchema);