import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { authenticate } from "../middleware/auth.middleware.js";
import { UserCredit } from "../models/UserCredit.js";
import { ensureCreditAccount } from "../services/credit-account.service.js";
import { CreditOperationError, reserveCredits } from "../services/credit-operations.service.js";

export const creditRouter = Router();

// Only trusted backend callers may provision accounts. This key must not be
// exposed to browsers; replace it with workload identity in deployment.
export async function provisionCreditAccount(req: Request, res: Response): Promise<void> {
  const expectedKey = process.env.CREDIT_INTERNAL_API_KEY;
  if (!expectedKey) {
    res.status(503).json({ error: "Credit account provisioning is unavailable" });
    return;
  }

  const suppliedKey = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "")?.[1];
  if (!suppliedKey) {
    res.status(401).json({ error: "Service authentication required" });
    return;
  }

  const expectedHash = createHash("sha256").update(expectedKey).digest();
  const suppliedHash = createHash("sha256").update(suppliedKey).digest();
  if (!timingSafeEqual(expectedHash, suppliedHash)) {
    res.status(403).json({ error: "Service authentication failed" });
    return;
  }

  const userId = req.params.userId;
  if (typeof userId !== "string" || !/^[0-9a-fA-F]{24}$/.test(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const isActive = req.body?.isActive === undefined ? true : req.body.isActive;
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }

  await ensureCreditAccount(new Types.ObjectId(userId), isActive);
  res.sendStatus(204);
}

creditRouter.put("/accounts/:userId", provisionCreditAccount);

/** Order Service calls this before acknowledging a newly created order. */
export async function reserveOrderCredits(req: Request, res: Response): Promise<void> {
  const expectedKey = process.env.ORDER_CREDIT_API_KEY;
  if (!expectedKey) {
    res.status(503).json({ error: "Credit reservation is unavailable" });
    return;
  }
  const suppliedKey = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "")?.[1];
  if (!suppliedKey) {
    res.status(401).json({ error: "Service authentication required" });
    return;
  }
  const expectedHash = createHash("sha256").update(expectedKey).digest();
  const suppliedHash = createHash("sha256").update(suppliedKey).digest();
  if (!timingSafeEqual(expectedHash, suppliedHash)) {
    res.status(403).json({ error: "Service authentication failed" });
    return;
  }

  const { orderId, requesterId, amount } = req.body ?? {};
  if (typeof orderId !== "string" || !/^[0-9a-fA-F]{24}$/.test(orderId) ||
      typeof requesterId !== "string" || !/^[0-9a-fA-F]{24}$/.test(requesterId) ||
      !Number.isSafeInteger(amount) || amount <= 0) {
    res.status(400).json({ error: "Valid orderId, requesterId, and positive integer amount are required" });
    return;
  }

  try {
    const result = await reserveCredits({
      orderId: new Types.ObjectId(orderId),
      requesterId: new Types.ObjectId(requesterId),
      amount,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof CreditOperationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Credit reservation failed", error);
    res.status(500).json({ error: "Credit reservation failed" });
  }
}

creditRouter.post("/reservations", reserveOrderCredits);

/** Return only the authenticated user's own balances. */
export async function getMyBalance(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Authentication required" });
    return;
  }
  try {
    const account = await UserCredit.findOne({ userId: new Types.ObjectId(req.user.userId) })
      .select("available reserve -_id")
      .lean();
    if (!account) {
      res.status(404).json({ code: "CREDIT_ACCOUNT_NOT_FOUND", error: "Credit account not found" });
      return;
    }
    res.json({ available: account.available, reserve: account.reserve });
  } catch (error) {
    console.error("Credit balance lookup failed", error);
    res.status(500).json({ code: "CREDIT_BALANCE_UNAVAILABLE", error: "Credit balance unavailable" });
  }
}

creditRouter.get("/me/balance", authenticate, getMyBalance);
