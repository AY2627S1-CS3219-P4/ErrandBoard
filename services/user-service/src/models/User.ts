import { model, Schema } from "mongoose";

export const ACCOUNT_TYPES = ["USER", "ADMIN", "SUPERADMIN"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface UserDocument {
  email: string;
  username: string;
  passwordHash: string;
  accountType: AccountType;
  isActive: boolean;
  authzVersion: number;
  creditSetupPending: boolean;
  creditSetupAttempts: number;
  creditSetupNextRetryAt?: Date;
  creditSetupLeaseId?: string;
  creditSetupLeaseUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: [/^e\d{7}@u\.nus\.edu$/, "A valid email address is required"],
    },
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      minlength: 3,
      maxlength: 30,
      match: [/^[a-zA-Z0-9_]{3,30}$/, "Username may contain letters, numbers, and underscores only"],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    accountType: {
      type: String,
      enum: ACCOUNT_TYPES,
      default: "USER",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
    authzVersion: {
      type: Number,
      default: 0,
      required: true,
      min: 0,
    },
    creditSetupPending: { type: Boolean, default: false, required: true },
    creditSetupAttempts: { type: Number, default: 0, min: 0, required: true },
    creditSetupNextRetryAt: Date,
    creditSetupLeaseId: String,
    creditSetupLeaseUntil: Date,
  },
  {
    collection: "users",
    timestamps: true,
  },
);

userSchema.index(
  { creditSetupNextRetryAt: 1 },
  { partialFilterExpression: { creditSetupPending: true } },
);

export const User = model<UserDocument>("User", userSchema);
