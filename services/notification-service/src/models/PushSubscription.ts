import { model, Schema } from "mongoose";

export interface PushSubscriptionDocument {
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
  userAgent?: string;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const pushSubscriptionSchema = new Schema<PushSubscriptionDocument>(
  {
    userId: { type: String, required: true },
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    expirationTime: { type: Number, default: null },
    userAgent: { type: String, maxlength: 300 },
    failureCount: { type: Number, default: 0, min: 0 },
  },
  { collection: "pushSubscriptions", timestamps: true },
);

// One row per browser installation (endpoint), owned by whoever last registered it.
pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ userId: 1 });

export const PushSubscriptionModel = model<PushSubscriptionDocument>("PushSubscription", pushSubscriptionSchema);