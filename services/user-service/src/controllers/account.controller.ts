import type { Request, Response } from "express";
import { ACCOUNT_TYPES, User } from "../models/User.js";
import { AuthorizationChangeError, updateManagedAccount } from "../services/authorization.service.js";
import { logger } from "../logger.js";

function actorId(req: Request): string | undefined {
  return req.user?.userId;
}

function accountResponse(account: InstanceType<typeof User>) {
  return {
    _id: account._id,
    email: account.email,
    username: account.username,
    accountType: account.accountType,
    isActive: account.isActive !== false,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

async function applyManagedChange(req: Request, res: Response, id: string, change: { accountType: "USER" | "ADMIN" } | { isActive: boolean }) {
  // Read the account before the change so the audit can record who was affected
  // (username) and the prior role, which the post-change document no longer holds.
  const before = await User.findById(id).select("username accountType isActive").lean();
  try {
    const account = await updateManagedAccount(id, change);
    if (!account) {
      logger.warn(
        {
          event: "accountType" in change ? "account.role_change_rejected" : "account.status_change_rejected",
          adminId: actorId(req),
          targetUserId: id,
          reason: "account_not_found",
        },
        "Account change rejected",
      );
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if ("accountType" in change) {
      logger.info(
        {
          event: "account.role_changed",
          adminId: actorId(req),
          targetUserId: id,
          targetUsername: before?.username,
          oldRole: before?.accountType,
          newRole: change.accountType,
        },
        "Account role changed by admin",
      );
    } else {
      logger.info(
        {
          event: "account.status_changed",
          adminId: actorId(req),
          targetUserId: id,
          targetUsername: before?.username,
          isActive: change.isActive,
        },
        "Account status changed by admin",
      );
    }
    res.json({ account: accountResponse(account) });
  } catch (error) {
    if (error instanceof AuthorizationChangeError) {
      logger.warn(
        {
          event: "accountType" in change ? "account.role_change_rejected" : "account.status_change_rejected",
          adminId: actorId(req),
          targetUserId: id,
          targetUsername: before?.username,
          reason: "authorization_change_error",
          status: error.status,
        },
        "Account change rejected",
      );
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
}

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
  await applyManagedChange(req, res, req.params.id as string, { accountType });
}

export async function updateAccountStatus(req: Request, res: Response): Promise<void> {
  const isActive = req.body?.isActive;
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }
  await applyManagedChange(req, res, req.params.id as string, { isActive });
}
