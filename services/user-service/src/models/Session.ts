import { model, Schema, Types } from "mongoose";

export interface SessionDocument {
  userId: Types.ObjectId;
  tokenHash: string;
  previousTokenHashes: string[];
  expiresAt: Date;
  revokedAt?: Date;
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    previousTokenHashes: {
      type: [String],
      default: [],
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: Date,
    userAgent: String,
    ipAddress: String,
  },
  {
    collection: "sessions",
    timestamps: true,
  },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ previousTokenHashes: 1 });

export const Session = model<SessionDocument>("Session", sessionSchema);
