import { model, Schema, type Types } from "mongoose";
import { ERRAND_STATUSES, type ErrandStatus } from "../status/errandState.js";
import { TERMINAL_CAUSES, type ActorRole, type TerminalCause } from "../event/types.js";

export interface SupplierCopy {
    supplierId: string;
    name: string;
    building: string;
    address: string;
    imageUrl?: string; //maybe for frontend stuff
}

// A status-change event that is owed to the broker. Written in the SAME atomic update as the
// transition (transactional outbox), removed once the broker confirms it.
export interface StatusOutboxEntry {
    eventId: string;
    status: ErrandStatus;
    previousStatus: ErrandStatus;
    actorRole: ActorRole;
    actorId?: string;
    at: Date;
    deadline?: Date;
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
    deliverBy?: Date;
    confirmBy?: Date;
    disputeReason?: string;
    disputedAt?: Date;
    disputedBy?: string; //requester userId, or "system" for an auto-dispute by the sweep
    terminalCause?: TerminalCause; //why the errand reached its terminal state (feeds the event payload)
    createdAt: Date;
    updatedAt: Date;
    eventPending?: boolean; //if true this errand owes an event operation
    notifyPending?: boolean; //if true notifyOutbox is non-empty (partial-indexed for the relay)
    notifyOutbox?: StatusOutboxEntry[];
}

//ErrandId
export interface ErrandRecord extends ErrandDocument {
  _id: Types.ObjectId;
}

const outboxEntrySchema = new Schema<StatusOutboxEntry>(
  {
    eventId: { type: String, required: true },
    status: { type: String, enum: ERRAND_STATUSES, required: true },
    previousStatus: { type: String, enum: ERRAND_STATUSES, required: true },
    actorRole: { type: String, enum: ["REQUESTER", "COURIER", "SYSTEM"], required: true },
    actorId: String,
    at: { type: Date, required: true },
    deadline: Date,
  },
  { _id: false },
);

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
    deliverBy: Date,
    confirmBy: Date,
    disputeReason: { type: String, trim: true, maxlength: 300 },
    disputedAt: Date,
    disputedBy: String,
    terminalCause: { type: String, enum: TERMINAL_CAUSES },
    eventPending: Boolean,
    notifyPending: Boolean,
    // default undefined: do not materialise an empty array on every new errand
    notifyOutbox: { type: [outboxEntrySchema], default: undefined },
    },
    { collection: "errands", timestamps: true }
);

errandSchema.index({ status: 1, expiresAt: 1 });
errandSchema.index({ status: 1, deliverBy: 1});
errandSchema.index({ status: 1, confirmBy: 1 });
errandSchema.index({ requesterId: 1, status: 1 });
errandSchema.index({ courierId: 1, status: 1 });
errandSchema.index({ status: 1, disputedAt: 1 }, { partialFilterExpression: { status: "DISPUTED" } });
errandSchema.index({ createdAt: -1 });
errandSchema.index({ eventPending: 1 }, { partialFilterExpression: { eventPending: true } });
errandSchema.index({ notifyPending: 1 }, { partialFilterExpression: { notifyPending: true } });

export const Errand = model<ErrandDocument>("Errand", errandSchema);