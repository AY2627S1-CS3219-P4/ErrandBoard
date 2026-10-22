import { model, Schema, type Types } from "mongoose";

export const CREATION_STATES = ["PENDING", "COMPLETED", "COMPENSATED", "RECONCILE"] as const;
export type CreationState = (typeof CREATION_STATES)[number];

export interface OrderCreationDocument {
  _id: Types.ObjectId;
  requesterId: string;
  amount: number;
  state: CreationState;
  retryAt: Date;
  retryAttempts: number;
  leaseId?: string;
  leaseUntil?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderCreationSchema = new Schema<OrderCreationDocument>({
  _id: { type: Schema.Types.ObjectId, required: true },
  requesterId: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  state: { type: String, enum: CREATION_STATES, required: true, default: "PENDING" },
  retryAt: { type: Date, required: true },
  retryAttempts: { type: Number, required: true, default: 0, min: 0 },
  leaseId: String,
  leaseUntil: Date,
  lastError: String,
}, { collection: "orderCreation", timestamps: true });

// Fresh databases and existing-volume migrations create this index as admin.
orderCreationSchema.index(
  { state: 1, retryAt: 1 },
  { partialFilterExpression: { state: "PENDING" } },
);

export const OrderCreation = model<OrderCreationDocument>("OrderCreation", orderCreationSchema);
