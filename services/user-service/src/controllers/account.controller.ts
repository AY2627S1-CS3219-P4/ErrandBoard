import type { Request, Response } from "express";
import { ACCOUNT_TYPES, User } from "../models/User.js";

export async function listManagedAccounts(_req: Request, res: Response): Promise<void> {
  const accounts = await User.find({ accountType: { $in: ["USER", "ADMIN"] } })
    .select("email username accountType createdAt updatedAt")
    .sort({ accountType: -1, username: 1 })
    .lean();
  res.json({ accounts });
}

export async function updateAccountRole(req: Request, res: Response): Promise<void> {
  const accountType = req.body?.accountType;
  if (!ACCOUNT_TYPES.includes(accountType) || accountType === "SUPERADMIN") {
    res.status(400).json({ error: "Account type must be USER or ADMIN" });
    return;
  }
  const account = await User.findOneAndUpdate(
    { _id: req.params.id, accountType: { $in: ["USER", "ADMIN"] } },
    { $set: { accountType } },
    { new: true, runValidators: true },
  ).select("email username accountType createdAt updatedAt").lean();
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  res.json({ account });
}
