import { model, Schema, Types } from "mongoose";



export interface UserCreditDocument {
  userId: Types.ObjectId;
  available: number;
  reserve: number;
  isActive: boolean;
}

const userCreditSchema = new Schema<UserCreditDocument>(
  {
    userId: {
        type: Schema.Types.ObjectId,
        required: true,
    },
    available: {
        type: Number,
        default: 100,
        required: true,
    },
    reserve: {
        type: Number,
        default: 0,
        required: true,
    },
    isActive: { type: Boolean, default: true, required: true }
  },
  {
    collection: "UserCredits",
    timestamps: true,
  },
);

userCreditSchema.index({ userId: 1 }, { unique: true });

export const UserCredit = model<UserCreditDocument>("UserCredits", userCreditSchema);
