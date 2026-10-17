import { Types } from "mongoose";
import { fetchActiveSupplier } from "../clients/supplier.client.js";
import { DeliveryDeadlinePassedError, ErrandNotFoundError, InvalidStatusTransitionError, SelfAssignErrandError, UpdateConflictError, ValidationError } from "../errors/order.errors.js";
import { publishTerminalEvent } from "../event/errand.events.js";
import { Errand, type ErrandRecord } from "../models/Errand.js";
import { ACTIVE_STATUSES } from "../status/errandState.js";
import { ERRAND_STATUSES, type ErrandStatus, validTransition } from "../status/errandState.js";

// all deadlines are two days for now
const EXPIRY_DEADLINE = 2 * 24 * 60 * 60 * 1000;
const COMPLETION_DEADLINE = 2 * 24 * 60 * 60 * 1000;  // for courier to indicate delivery has been completed
const CONFIRMATION_DEADLINE = 2 * 24 * 60 * 60 * 1000;  // for requester to confirm receipt of delivery
export interface CreateErrandInput {
    requesterId: string;
    supplierId: string;
    dropoff: string;
    description: string;
    credit: number;
}

export interface ListFilters {
  supplierId?: string[];
  building?: string[];   
  address?: string[];
  dropoff?: string;      // drop-off location (substring)
  q?: string;            // keyword in the errand details
  since?: Date;          // creation time
}

//maybe have a file specifically for utility functions i have a feeling there will be a lot
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//the regex is specifically for mongodb ObjectIDs
export function isObjectIdString(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

//read functions
export async function listOpenErrands(viewId: string, filters: ListFilters) {
    const now = new Date();

    //create query based on filter
    const query: Record<string, unknown> = {status: "OPEN", expiresAt: {$gt: now}};
    if (filters.supplierId?.length) query["supplier.supplierId"] = { $in: filters.supplierId };
    if (filters.building?.length) query["supplier.building"] = { $in: filters.building};
    if (filters.address?.length) query["supplier.address"] = { $in: filters.address };
    if (filters.dropoff) query["dropoff"] = { $regex: escapeRegex(filters.dropoff), $options: "i" };
    if (filters.q) query["description"] = { $regex: escapeRegex(filters.q), $options: "i" };
    if (filters.since) query["createdAt"] = { $gte: filters.since };
    
    const errands = await Errand.find(query).sort({ createdAt : -1});

    return errands;
}

//list errands with active status and the requester/courier id is yours
export async function listMyErrands(userId: string) {
    const errands = await Errand.find({
        status: { $in: ACTIVE_STATUSES},
        $or: [{ requesterId:userId }, { courierId: userId}]
    }).sort({ updatedAt: -1 }) as unknown as ErrandRecord[];

    return errands;
}

export async function getErrand(userId: string, id: string): Promise<ErrandRecord>{
    if (!isObjectIdString(id)) throw new ErrandNotFoundError;

    const errand = (await Errand.findById(id)) as ErrandRecord | null;
    if (!errand) throw new ErrandNotFoundError();

    const involved = errand.requesterId === userId || errand.courierId === userId;
    const publicListing = errand.status === "OPEN" && errand.expiresAt > new Date();
    if (!involved && !publicListing) throw new ErrandNotFoundError();

    return errand;
}

export async function createErrand(input: CreateErrandInput): Promise<ErrandRecord> {
  // supplier service would fail with a 500 on a malformed id, so reject it here
  if (!isObjectIdString(input.supplierId)) {
    throw new ValidationError({ supplierId: "supplierId must be a valid supplier id" });
  }
  // throws if the supplier does not exist or has been deactivated
  const supplier = await fetchActiveSupplier(input.supplierId);

  const errand = await Errand.create({
    requesterId: input.requesterId,
    supplier,
    dropoff: input.dropoff,
    description: input.description,
    credit: input.credit,
    status: "OPEN",
    expiresAt: new Date(Date.now() + EXPIRY_DEADLINE),
  });

  return errand;
}

async function updateErrand(id: string, from: ErrandStatus, to: ErrandStatus, filter: Record<string, unknown> = {}, update: Record<string, unknown> = {}) {
  if (!validTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
  if (!isObjectIdString(id)) throw new ErrandNotFoundError;

  const updated = await Errand.findOneAndUpdate(
    // checking and updating of errand are in the same operation
    { _id: id, status: from, ...filter },
    { $set: { status: to, ...update } },
    { new: true, runValidators: true }
  ) as ErrandRecord | null;

  if (!updated) {
    const existing = await Errand.findById(id);
    if (!existing) throw new ErrandNotFoundError();
    throw new UpdateConflictError();
  }

  await publishTerminalEvent(updated);
  
  return updated;
}

// assign courier and update errand status to "ACCEPTED"
export async function acceptErrand(id: string, courierId: string) {
  try {
    const updated = await updateErrand(id, "OPEN", "ACCEPTED", 
      { 
        courierId: { $exists: false },  // courier must not have been assigned before
        requesterId: { $ne: courierId },    // requester cannot take their own errand
        expiresAt: { $gt: new Date() } // expired errands cannot be accepted
      }, { courierId })

    return updated;
  } catch (error) {
    if (error instanceof UpdateConflictError) {
      const existing = await Errand.findById(id);
      if (existing?.requesterId === courierId) throw new SelfAssignErrandError();
      throw error;
    }
    throw error;
  }
}

export async function pickUpErrand(id: string, courierId: string) {
  const updated = await updateErrand(id, "ACCEPTED", "PICKED_UP",
    { courierId },
    { completeBy: new Date(Date.now() + COMPLETION_DEADLINE) }
  );

  return updated;
}

export async function deliverErrand(id: string, courierId: string) {
  try {
    const updated = await updateErrand(id, "PICKED_UP", "PENDING_COMPLETION",
      { courierId,
        completeBy: { $gt: new Date() } },  // courier should not be able to deliver errand later than the deadline
      { confirmBy: new Date(Date.now() + CONFIRMATION_DEADLINE) }
    );

    return updated;
  } catch (error) {
    if (error instanceof UpdateConflictError) {
      const existing = await Errand.findById(id);
      if (existing?.status === "PICKED_UP" && existing.courierId === courierId
          && existing.completeBy && existing.completeBy <= new Date()) {
        throw new DeliveryDeadlinePassedError();
      }
    }
    throw error;
  }
}


export async function completeErrand(id: string, requesterId: string) {
  const updated = await updateErrand(id, "PENDING_COMPLETION", "COMPLETED",
    { requesterId }
  );

  return updated;
}

// requesters can cancel only an open errand they created
export async function cancelErrandByRequester(id: string, requesterId: string) {
  const updated = await updateErrand(id, "OPEN", "CANCELLED",
    { requesterId }
  );

  return updated;
}

// couriers can cancel only an errand they accepted
export async function cancelErrandByCourier(id: string, courierId: string) {
  const updated = await updateErrand(id, "ACCEPTED", "CANCELLED",
    { courierId }
  );

  return updated;
}

