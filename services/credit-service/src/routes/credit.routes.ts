import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { ensureCreditAccount } from "../services/credit-account.service.js";

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
