import { model, Schema } from "mongoose";

export const ACCOUNT_TYPES = ["USER", "ADMIN", "SUPERADMIN"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface UserDocument {
  email: string;
  username: string;
  passwordHash: string;
  accountType: AccountType;
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
  },
  {
    collection: "users",
    timestamps: true,
  },
);

export const User = model<UserDocument>("User", userSchema);
