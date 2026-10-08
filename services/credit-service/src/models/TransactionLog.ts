import { model, Schema, Types } from "mongoose";



export const TRANSACTION_TYPES = ["RESERVE", "REFUND", "DEDUCT", "ADD"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface TransactionLogDocument {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  transactionType: TransactionType;
  amountTransferred: number;
}

const transactionLogSchema = new Schema<TransactionLogDocument>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    transactionType: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    amountTransferred: {
      type: Number,
      required: true
    }
  },
  {
    collection: "transactionLog",
    timestamps: true,
  },
);

// transactionLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// transactionLogSchema.index({ previousTokenHashes: 1 });

export const TransactionLog = model<TransactionLogDocument>("TransactionLog", transactionLogSchema);
