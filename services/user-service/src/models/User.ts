import { model, Schema } from "mongoose";

export type AccountType = "USER" | "ADMIN";

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
      match: [/^\S+@\S+\.\S+$/, "A valid email address is required"],
    },
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      minlength: 3,
      maxlength: 30,
      match: [/^[a-zA-Z0-9_]+$/, "Username may contain letters, numbers, and underscores only"],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    accountType: {
      type: String,
      enum: ["USER", "ADMIN"],
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
