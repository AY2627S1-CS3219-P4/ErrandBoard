import { Types } from "mongoose";
import { Errand, type ErrandRecord } from "../model/Errand.js";
import { ACTIVE_STATUSES } from "../status/errandState.js";

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

//maybe have a file specifically for errors same as above
export class ErrandNotFoundError extends Error {
  constructor() {
    super("Errand not found");
  }
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
    if (filters.q) query["q"] = { $regex: escapeRegex(filters.q), $options: "i" };
    if (filters.since) query["since"] = { $gte: filters.since };
    
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

    const involved = errand.requesterId === userId || errand.requesterId === userId;
    const publicListing = errand.status === "OPEN" && errand.expiresAt > new Date();
    if (!involved && !publicListing) throw new ErrandNotFoundError();

    return errand;
}

