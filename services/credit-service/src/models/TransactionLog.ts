import { model, Schema, Types } from "mongoose";

export const TRANSACTION_TYPES = ["ORDER_START", "ORDER_END"] as const;
export const CREDIT_ACTIONS = ["RESERVE", "REFUND", "TRANSFER"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type CreditAction = (typeof CREDIT_ACTIONS)[number];

export interface TransactionLogDocument {
  orderId: Types.ObjectId;
  transactionType: TransactionType;
  action: CreditAction;
  requesterId: Types.ObjectId;
  courierId?: Types.ObjectId;
  amount: number;
}

const transactionLogSchema = new Schema<TransactionLogDocument>(
  {
    orderId: { type: Schema.Types.ObjectId, required: true },
    transactionType: { type: String, enum: TRANSACTION_TYPES, required: true },
    action: { type: String, enum: CREDIT_ACTIONS, required: true },
    requesterId: { type: Schema.Types.ObjectId, required: true },
    courierId: { type: Schema.Types.ObjectId },
    amount: { type: Number, required: true, min: 1 },
  },
  { collection: "transactionLog", timestamps: true },
);

// The database migration creates this index; autoIndex is disabled at runtime.
transactionLogSchema.index({ orderId: 1, transactionType: 1 }, { unique: true });

export const TransactionLog = model<TransactionLogDocument>("TransactionLog", transactionLogSchema);
