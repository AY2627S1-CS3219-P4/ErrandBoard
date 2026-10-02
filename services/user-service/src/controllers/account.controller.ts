import type { Request, Response } from "express";
import { ACCOUNT_TYPES, User } from "../models/User.js";

export async function listManagedAccounts(_req: Request, res: Response): Promise<void> {
  const accounts = await User.find({ accountType: { $in: ["USER", "ADMIN"] } })
    .select("email username accountType isActive createdAt updatedAt")
    .sort({ accountType: -1, username: 1 })
    .lean();
  // Older documents may not have this field; the schema default is not applied by lean().
  res.json({ accounts: accounts.map((account) => ({ ...account, isActive: account.isActive !== false })) });
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
  ).select("email username accountType isActive createdAt updatedAt").lean();
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  res.json({ account: { ...account, isActive: account.isActive !== false } });
}

export async function updateAccountStatus(req: Request, res: Response): Promise<void> {
  const isActive = req.body?.isActive;
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }
  const account = await User.findOneAndUpdate(
    { _id: req.params.id, accountType: { $in: ["USER", "ADMIN"] } },
    { $set: { isActive } },
    { new: true, runValidators: true },
  ).select("email username accountType isActive createdAt updatedAt").lean();
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  res.json({ account });
}
