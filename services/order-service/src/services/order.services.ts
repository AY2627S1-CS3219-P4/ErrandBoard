import { Types } from "mongoose";
import { logger } from "../logger.js";
import { fetchActiveSupplier } from "../clients/supplier.client.js";
import { reserveCredits } from "../clients/credit.client.js";
import { CreditRecoveryRequiredError, DeliveryDeadlinePassedError, DisputeResolvedError, ErrandNotFoundError, InsufficientCreditsError, InvalidStatusTransitionError, OrderCreationPendingError, SelfAssignErrandError, UpdateConflictError, ValidationError } from "../errors/order.errors.js";
import { publishTerminalEvent } from "../event/errand.events.js";
import { publishStatusEvents, statusEventId } from "../event/status.events.js";
import { SYSTEM_ACTOR, type Actor } from "../event/types.js";
import { Errand, type ErrandRecord, type StatusOutboxEntry } from "../models/Errand.js";
import { closeUnreservedCreation, queueCreationRecovery, recordOrderCreation, saveErrandAndCompleteCreation } from "./order-creation.service.js";
import { ACTIVE_STATUSES, ERRAND_STATUSES, HELD_STATUSES, isTerminal } from "../status/errandState.js";
import { type ErrandStatus, validTransition } from "../status/errandState.js";

export const DISPUTE_REASON_MAXLENGTH = 300;

export const EXPIRY_DEADLINE = 2 * 24 * 60 * 60 * 1000;
export const DELIVERY_DEADLINE = 5 * 24 * 60 * 60 * 1000;  // for courier to indicate delivery has been completed
export const CONFIRMATION_DEADLINE = 2 * 24 * 60 * 60 * 1000;  // for requester to confirm receipt of delivery
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
        status: { $in: [...ACTIVE_STATUSES, ...HELD_STATUSES]},
        $or: [{ requesterId:userId }, { courierId: userId}]
    }).sort({ updatedAt: -1 }) as unknown as ErrandRecord[];

    return errands;
}

// admin-scoped read: all disputed errands, oldest dispute first (a FIFO queue).
// authorization is enforced at the route via requireAdmin.
export async function listDisputedErrands() {
    const errands = await Errand.find({ status: "DISPUTED" })
        .sort({ disputedAt: 1 }) as unknown as ErrandRecord[];

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

  //manually assign id for credit reservation
  const _id = new Types.ObjectId();
  const creditInput = {
    orderId: _id.toString(),
    requesterId: input.requesterId,
    amount: input.credit,
  };
  const errandData = {
    _id,
    requesterId: input.requesterId,
    supplier,
    dropoff: input.dropoff,
    description: input.description,
    credit: input.credit,
    status: "OPEN",
    expiresAt: new Date(Date.now() + EXPIRY_DEADLINE),
  } as const;
  // Reject schema-invalid input before any Credit operation can move funds.
  await new Errand(errandData).validate();
  // This intent survives a crash between Credit's commit and Errand.create.
  await recordOrderCreation(creditInput);

  try {
    await reserveCredits(creditInput);
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      try { await closeUnreservedCreation(creditInput.orderId); } catch (writeError) {
        logger.error({ err: writeError }, "Could not close rejected order creation");
      }
      throw error;
    }
    if (error instanceof CreditRecoveryRequiredError) {
      // A conflicting Credit log needs an operator rather than endless retries.
      logger.error({ orderId: _id }, "Order needs manual Credit reconciliation");
    }
    try { await queueCreationRecovery(creditInput.orderId, error); } catch (writeError) {
      logger.error({ err: writeError }, "Could not expedite order creation recovery");
    }
    throw new OrderCreationPendingError();
  }

  let errand: ErrandRecord;
  try {
    errand = await saveErrandAndCompleteCreation(errandData);
  } catch (error) {
    // A lost write reply may hide a committed transaction. This request may
    // confirm an existing Errand, but only the leased worker may compensate:
    // its intent claim fences a still-in-flight transaction before refunding.
    try {
      const confirmed = await Errand.findById(_id) as ErrandRecord | null;
      if (confirmed) return confirmed;
    } catch (recoveryError) {
      logger.error({ err: recoveryError, orderId: _id }, "Order write outcome could not be checked");
    }
    try { await queueCreationRecovery(creditInput.orderId, error); } catch (writeError) {
      logger.error({ err: writeError }, "Could not expedite order creation recovery");
    }
    throw new OrderCreationPendingError();
  }

  return errand;
}

async function updateErrand(
  id: string, 
  from: ErrandStatus | ErrandStatus[], 
  to: ErrandStatus, 
  filter: Record<string, unknown> = {}, 
  update: Record<string, unknown> = {}, 
  actor: Actor = SYSTEM_ACTOR) {
    
  // To support atomic transition from multiple source states e.g. ACCEPTED/PICKED_UP -> DISPUTED
  const froms = Array.isArray(from) ? from : [from];

  for (const source of froms) {
    if (!validTransition(source, to)) {
      throw new InvalidStatusTransitionError(source, to);
    }
  }
  if (!isObjectIdString(id)) throw new ErrandNotFoundError;

  let source: ErrandStatus = froms[0]

  for (let attempt = 0; attempt < 3; attempt++) {
    if (froms.length > 1) {
      const current = await Errand.findById(id) as ErrandRecord | null;
      if (!current) throw new ErrandNotFoundError();
      if (!froms.includes(current.status)) throw new UpdateConflictError();
      source= current.status
    }

    // Notification outbox entry: committed atomically with the transition, so a crash or broker outage
    // can delay a status notification but never lose it.
    const deadline = [update.deliverBy, update.confirmBy].find((d): d is Date => d instanceof Date);
    const outboxEntry: StatusOutboxEntry = {
      eventId: statusEventId(id, to),
      status: to,
      previousStatus: source,
      actorRole: actor.role,
      ...(actor.userId ? { actorId: actor.userId } : {}),
      at: new Date(),
      ...(deadline ? { deadline } : {}),
    };

    const updated = await Errand.findOneAndUpdate(
      // checking and updating of errand are in the same operation
      { _id: id, status: source, ...filter},
      {
        $set: { status: to, ...update , ...(isTerminal(to) ? { eventPending: true } : {}), notifyPending: true },
        $push: { notifyOutbox: outboxEntry },
      },
      { returnDocument: 'after', runValidators: true }
    ) as ErrandRecord | null;

    if (updated) {
      await publishTerminalEvent(updated);
      await publishStatusEvents(updated); // best effort; leftovers are relayed by the sweep
    
      return updated;

    }

      const existing = await Errand.findById(id) as ErrandRecord | null;
      if (!existing) throw new ErrandNotFoundError();
      
      if (froms.length > 1  && existing.status !== source && froms.includes(existing.status)) continue;
      throw new UpdateConflictError();
  }

  //every retry fails due to concurrent transition
  throw new UpdateConflictError();
}

// assign courier and update errand status to "ACCEPTED"
export async function acceptErrand(id: string, courierId: string) {
  try {
    const updated = await updateErrand(id, "OPEN", "ACCEPTED", 
      { 
        courierId: { $exists: false },  // courier must not have been assigned before
        requesterId: { $ne: courierId },    // requester cannot take their own errand
        expiresAt: { $gt: new Date() } // expired errands cannot be accepted
      }, { courierId }, { role: "COURIER", userId: courierId })

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
    { deliverBy: new Date(Date.now() + DELIVERY_DEADLINE) },
    { role: "COURIER", userId: courierId }
  );

  return updated;
}

export async function deliverErrand(id: string, courierId: string) {
  try {
    const updated = await updateErrand(id, "PICKED_UP", "PENDING_COMPLETION",
      { courierId,
        deliverBy: { $gt: new Date() } },  // courier should not be able to deliver errand later than the deadline
      { confirmBy: new Date(Date.now() + CONFIRMATION_DEADLINE) },
      { role: "COURIER", userId: courierId }
    );

    return updated;
  } catch (error) {
    if (error instanceof UpdateConflictError) {
      const existing = await Errand.findById(id);
      if (existing?.status === "PICKED_UP" && existing.courierId === courierId
          && existing.deliverBy && existing.deliverBy <= new Date()) {
        throw new DeliveryDeadlinePassedError();
      }
    }
    throw error;
  }
}


export async function completeErrand(id: string, requesterId: string) {
  const updated = await updateErrand(id, "PENDING_COMPLETION", "COMPLETED",
    { requesterId }, {terminalCause: "CONFIRMED"}, { role: "REQUESTER", userId: requesterId }
  );

  return updated;
}

// requesters can cancel only an open errand they created
export async function cancelErrandByRequester(id: string, requesterId: string) {
  const updated = await updateErrand(id, "OPEN", "CANCELLED",
    { requesterId }, {terminalCause: "REQUESTER_CANCELLED"}, { role: "REQUESTER", userId: requesterId }
  );

  return updated;
}

// couriers can cancel only an errand they accepted
export async function cancelErrandByCourier(id: string, courierId: string) {
  const updated = await updateErrand(id, "ACCEPTED", "CANCELLED",
    { courierId }, {terminalCause: "COURIER_CANCELLED"}, { role: "COURIER", userId: courierId }
  );

  return updated;
}

// a picked-up errand past its delivery deadline is auto-disputed (held for admin review),
// not cancelled. Credits stay reserved until an admin resolves the dispute.
export async function disputeErrandAfterDeadline(id: string) {
  return await updateErrand(id, "PICKED_UP", "DISPUTED", {},
    { disputeReason: "Delivery deadline passed", disputedAt: new Date(), disputedBy: "system" }
  );
}

export async function expireOpenErrand(id: string) {
  return await updateErrand(id, "OPEN", "EXPIRED", {}, { terminalCause: "EXPIRED" });
}

export async function completeErrandAfterDeadline(id: string) {
  return await updateErrand(id, "PENDING_COMPLETION", "COMPLETED", {}, { terminalCause: "AUTO_CONFIRMED" });
}

// a requester disputes an errand they created that is in progress or awaiting their confirmation.
// no event is emitted: credits stay reserved until an admin resolves the dispute.
// A PENDING_COMPLETION errand (the courier marked it delivered) can be disputed only while the
// confirmation window is still open; once confirmBy passes the sweep auto-completes and pays the courier.
export async function disputeErrand(id: string, requesterId: string, reason: string) {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new ValidationError({ reason: "A dispute reason is required" });
  if (trimmed.length > DISPUTE_REASON_MAXLENGTH) {
    throw new ValidationError({ reason: `Reason must be at most ${DISPUTE_REASON_MAXLENGTH} characters` });
  }

  return await updateErrand(id, ["ACCEPTED", "PICKED_UP", "PENDING_COMPLETION"], "DISPUTED",
    {
      requesterId,
      // the confirm-window guard applies only to PENDING_COMPLETION, which is the only state with confirmBy
      $or: [
        { status: { $in: ["ACCEPTED", "PICKED_UP"] } },
        { status: "PENDING_COMPLETION", confirmBy: { $gt: new Date() } },
      ],
    },
    { disputeReason: trimmed, disputedAt: new Date(), disputedBy: requesterId },
    { role: "REQUESTER", userId: requesterId}
  );
}

// Drives a DISPUTED errand to its terminal outcome. A dispute resolves exactly once, so a
// second attempt (e.g. two admins working the queue) should read as "already resolved" rather
// than a generic conflict. The pre-read is a fast, friendly path; the atomic CAS in updateErrand
// is the real guard against a concurrent resolve slipping in between the read and the write.
async function resolveDispute(id: string, to: "CANCELLED" | "COMPLETED", adminId: string) {
  if (!isObjectIdString(id)) throw new ErrandNotFoundError();

  const existing = await Errand.findById(id) as ErrandRecord | null;
  if (!existing) throw new ErrandNotFoundError();
  // terminal states never transition out, so this is already a settled dispute
  if (isTerminal(existing.status)) throw new DisputeResolvedError(existing.status);

  const cause = to === "CANCELLED" ? "DISPUTE_REFUNDED" : "DISPUTE_TRANSFERRED";
  try {
    return await updateErrand(id, "DISPUTED", to, {}, { terminalCause: cause }, {role: "ADMIN", userId: adminId});
  } catch (error) {
    // lost the race: someone resolved it after our pre-read
    if (error instanceof UpdateConflictError) {
      const latest = await Errand.findById(id) as ErrandRecord | null;
      if (latest && isTerminal(latest.status)) throw new DisputeResolvedError(latest.status);
    }
    throw error;
  }
}

// admin resolves a dispute in the requester's favour: DISPUTED -> CANCELLED
// emits errand.cancelled, so the credit service refunds the requester.
export async function resolveDisputeRefund(id: string, adminId: string) {
  return await resolveDispute(id, "CANCELLED", adminId);
}

// admin resolves a dispute in the courier's favour: DISPUTED -> COMPLETED
// emits errand.completed, so the credit service transfers the credit to the courier.
export async function resolveDisputeTransfer(id: string, adminId: string) {
  return await resolveDispute(id, "COMPLETED", adminId);
}

// shape returned by getErrandStats: a count per status plus derived subtotals and dispute detail
export interface ErrandStats {
  total: number;
  active: number;      // sum over ACTIVE_STATUSES (OPEN, ACCEPTED, PICKED_UP, PENDING_COMPLETION)
  openActive: number;  // currently-claimable: status OPEN and not yet expired
  open: number;
  accepted: number;
  picked_up: number;
  pending_completion: number;
  completed: number;
  expired: number;
  cancelled: number;
  disputed: number;
  disputedBySystem: number;     // dispute auto-raised by the deadline sweep (disputedBy === "system")
  disputedByRequester: number;  // dispute raised by a requester (any other disputedBy)
  creditsHeld: number;          // sum of credit currently locked in DISPUTED errands
}

// admin-scoped read: platform-wide errand statistics for the admin dashboard.
// authorization is enforced at the route via requireAdmin.
export async function getErrandStats(): Promise<ErrandStats> {
  const now = new Date();

  const [byStatus, openActive, disputeDetail] = await Promise.all([
    // one count per status
    Errand.aggregate<{ _id: ErrandStatus; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    // currently-claimable open errands (OPEN and not expired)
    Errand.countDocuments({ status: "OPEN", expiresAt: { $gt: now } }),
    // dispute split (by origin) + credits held, over DISPUTED errands only
    Errand.aggregate<{ _id: boolean; count: number; credit: number }>([
      { $match: { status: "DISPUTED" } },
      {
        $group: {
          _id: { $eq: ["$disputedBy", "system"] },
          count: { $sum: 1 },
          credit: { $sum: "$credit" },
        },
      },
    ]),
  ]);

  // fold the status aggregation into a map with every status defaulted to 0
  const counts = Object.fromEntries(ERRAND_STATUSES.map((s) => [s, 0])) as Record<ErrandStatus, number>;
  for (const row of byStatus) {
    if (row._id in counts) counts[row._id] = row.count;
  }

  const total = ERRAND_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const active = ACTIVE_STATUSES.reduce((sum, s) => sum + counts[s], 0);

  let disputedBySystem = 0;
  let disputedByRequester = 0;
  let creditsHeld = 0;
  for (const row of disputeDetail) {
    if (row._id) disputedBySystem = row.count;
    else disputedByRequester = row.count;
    creditsHeld += row.credit;
  }

  return {
    total,
    active,
    openActive,
    open: counts.OPEN,
    accepted: counts.ACCEPTED,
    picked_up: counts.PICKED_UP,
    pending_completion: counts.PENDING_COMPLETION,
    completed: counts.COMPLETED,
    expired: counts.EXPIRED,
    cancelled: counts.CANCELLED,
    disputed: counts.DISPUTED,
    disputedBySystem,
    disputedByRequester,
    creditsHeld,
  };
}
