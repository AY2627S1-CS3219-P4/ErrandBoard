import mongoose, { Types } from "mongoose";
import { TransactionLog, type CreditAction, type TransactionType } from "../models/TransactionLog.js";
import { UserCredit } from "../models/UserCredit.js";

export class CreditOperationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface CreditOperation {
  orderId: Types.ObjectId;
  requesterId: Types.ObjectId;
  amount: number;
  courierId?: Types.ObjectId;
}

export interface CreditOperationResult { applied: boolean }

export type ReservationState = "NOT_RESERVED" | "RESERVED" | "REFUNDED" | "TRANSFERRED";
export interface ReservationStatus {
  state: ReservationState;
  requesterId?: string;
  amount?: number;
  courierId?: string;
}

/** Read the durable operation log after a lost reservation or release response. */
export async function getReservationStatus(orderId: Types.ObjectId): Promise<ReservationStatus> {
  const start = await TransactionLog.findOne({ orderId, transactionType: "ORDER_START" });
  const end = await TransactionLog.findOne({ orderId, transactionType: "ORDER_END" });
  if (!start && !end) return { state: "NOT_RESERVED" };
  if (!start || start.action !== "RESERVE" ||
      end && (!end.requesterId.equals(start.requesterId) || end.amount !== start.amount)) {
    throw new CreditOperationError(409, "Credit operation log needs reconciliation");
  }
  if (end && (end.action !== "REFUND" && end.action !== "TRANSFER" ||
      end.action === "TRANSFER" && !end.courierId)) {
    throw new CreditOperationError(409, "Credit operation log needs reconciliation");
  }
  return {
    state: end ? end.action === "REFUND" ? "REFUNDED" : "TRANSFERRED" : "RESERVED",
    requesterId: start.requesterId.toString(),
    amount: start.amount,
    ...(end?.action === "TRANSFER" && end.courierId ? { courierId: end.courierId.toString() } : {}),
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

function sameOperation(
  existing: { action: CreditAction; requesterId: Types.ObjectId; courierId?: Types.ObjectId; amount: number },
  action: CreditAction,
  operation: CreditOperation,
): boolean {
  return existing.action === action &&
    existing.requesterId.equals(operation.requesterId) &&
    (existing.courierId?.toString() ?? null) === (operation.courierId?.toString() ?? null) &&
    existing.amount === operation.amount;
}

async function applyOperation(
  transactionType: TransactionType,
  action: CreditAction,
  operation: CreditOperation,
): Promise<CreditOperationResult> {
  if (!Number.isSafeInteger(operation.amount) || operation.amount <= 0) {
    throw new CreditOperationError(400, "Amount must be a positive integer");
  }
  if (action === "TRANSFER" && (!operation.courierId || operation.courierId.equals(operation.requesterId))) {
    throw new CreditOperationError(400, "A different courier account is required");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (transactionType === "ORDER_END") {
        const start = await TransactionLog.findOne({
          orderId: operation.orderId,
          transactionType: "ORDER_START",
        }).session(session);
        if (!start || start.action !== "RESERVE" ||
          !start.requesterId.equals(operation.requesterId) || start.amount !== operation.amount) {
          throw new CreditOperationError(409, "No matching credit reservation exists");
        }
      }

      // One log row represents the entire operation, including both updates for a transfer.
      await TransactionLog.create([{
        orderId: operation.orderId,
        transactionType,
        action,
        requesterId: operation.requesterId,
        courierId: operation.courierId,
        amount: operation.amount,
      }], { session });

      const requesterUpdate = action === "RESERVE"
        ? { $inc: { available: -operation.amount, reserve: operation.amount } }
        : action === "REFUND"
          ? { $inc: { reserve: -operation.amount, available: operation.amount } }
          : { $inc: { reserve: -operation.amount } };
      const balanceField = action === "RESERVE" ? "available" : "reserve";
      const requester = await UserCredit.updateOne(
        {
          userId: operation.requesterId,
          ...(action === "RESERVE" ? { isActive: true } : {}),
          [balanceField]: { $gte: operation.amount },
        },
        requesterUpdate,
        { session },
      );
      if (requester.matchedCount !== 1) {
        throw new CreditOperationError(409, "Requester account cannot cover this credit operation");
      }

      if (action === "TRANSFER") {
        const courier = await UserCredit.updateOne(
          { userId: operation.courierId },
          { $inc: { available: operation.amount } },
          { session },
        );
        if (courier.matchedCount !== 1) {
          throw new CreditOperationError(409, "Courier account is missing");
        }
      }
    });
    return { applied: true };
  } catch (error) {
    if (isDuplicateKey(error)) {
      const existing = await TransactionLog.findOne({ orderId: operation.orderId, transactionType });
      if (existing && sameOperation(existing, action, operation)) return { applied: false };
      throw new CreditOperationError(409, "A different credit operation already exists for this order phase");
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export function reserveCredits(operation: CreditOperation): Promise<CreditOperationResult> {
  const { courierId: _ignored, ...reservation } = operation;
  return applyOperation("ORDER_START", "RESERVE", reservation);
}

export function refundCredits(operation: CreditOperation): Promise<CreditOperationResult> {
  const { courierId: _ignored, ...refund } = operation;
  return applyOperation("ORDER_END", "REFUND", refund);
}

export function transferCredits(operation: CreditOperation): Promise<CreditOperationResult> {
  return applyOperation("ORDER_END", "TRANSFER", operation);
}
