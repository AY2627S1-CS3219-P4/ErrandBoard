import { model, Schema, type Types } from "mongoose";
import { ERRAND_STATUSES, type ErrandStatus } from "../status/errandState.js";

export interface SupplierCopy {
    supplierId: string;
    name: string;
    building: string;
    address: string;
    imageUrl?: string; //maybe for frontend stuff
}

export interface ErrandDocument {
    requesterId: string;
    courierId?: string;
    supplier: SupplierCopy;
    dropoff: string; //decided to split this off from description
    description: string;
    credit: number;
    status: ErrandStatus;
    expiresAt: Date;
    completeBy?: Date;
    confirmBy?: Date;
    createdAt: Date;
    updatedAt: Date;
}

//ErrandId
export interface ErrandRecord extends ErrandDocument {
  _id: Types.ObjectId;
}

const errandSchema = new Schema<ErrandDocument>(
  {
    requesterId: { type: String, required: true, index: false },
    courierId: String,
    supplier: {
        supplierId: { type: String, required: true },
        name: { type: String, required: true },
        building: { type: String, required: true },
        address: String,
        imageUrl: String,
    },
    dropoff: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    credit: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ERRAND_STATUSES, required: true, default: "OPEN" },
    expiresAt: { type: Date, required: true },
    completeBy: Date,
    confirmBy: Date
    },
    { collection: "errands", timestamps: true }
);

errandSchema.index({ status: 1, expiresAt: 1 });
errandSchema.index({ status: 1, completeBy: 1});
errandSchema.index({ status: 1, confirmBy: 1 });
errandSchema.index({ requesterId: 1, status: 1 });
errandSchema.index({ courierId: 1, status: 1 });
errandSchema.index({ createdAt: -1 });

export const Errand = model<ErrandDocument>("Errand", errandSchema);