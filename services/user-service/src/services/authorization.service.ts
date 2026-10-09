import { Session } from "../models/Session.js";
import { User, type AccountType } from "../models/User.js";
import { authorizationStore, checkAuthorization } from "../security/authorization-state.js";
import { syncCreditAccount } from "./credit-account.client.js";

export class AuthorizationChangeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// The Redis block is visible to every verifier before any durable change.
// If MongoDB fails ambiguously, leave the block in place until an operator
// reconciles Redis from MongoDB while writes are stopped.
export async function changeAuthorization<T extends InstanceType<typeof User>>(
  user: T,
  update: () => Promise<T | null>,
): Promise<T> {
  const id = user._id.toString();
  let previous;
  try {
    previous = await authorizationStore.block(id, user);
  } catch {
    throw new AuthorizationChangeError(503, "Authorization state is unavailable. Please retry later.");
  }

  try {
    await Session.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
  } catch (error) {
    await authorizationStore.restore(id, previous);
    throw error;
  }

  const updated = await update();
  if (!updated) {
    await authorizationStore.restore(id, previous);
    throw new AuthorizationChangeError(409, "Account changed during this request. Please retry.");
  }
  await authorizationStore.publish(id, previous, updated);
  return updated;
}

export async function updateManagedAccount(
  userId: string,
  change: { accountType: AccountType } | { isActive: boolean },
) {
  const user = await User.findOne({ _id: userId, accountType: { $in: ["USER", "ADMIN"] } });
  if (!user) return null;
  if ("accountType" in change && user.accountType === change.accountType) {
    const decision = await checkAuthorization(user._id.toString(), user.accountType, user.authzVersion ?? 0);
    if (decision === "unavailable" || decision === "revoked") {
      throw new AuthorizationChangeError(503, "Authorization state is unavailable. Please retry later.");
    }
    return user;
  }

  const version = user.authzVersion ?? 0;
  return changeAuthorization(user, async () => {
    const updated = await User.findOneAndUpdate(
      {
        _id: user._id,
        accountType: user.accountType,
        authzVersion: version === 0 ? { $in: [null, 0] } : version,
      },
      { $set: change, $inc: { authzVersion: 1 } },
      { returnDocument: "after", runValidators: true },
    );
    if (updated && "isActive" in change) {
      try {
        await syncCreditAccount(updated._id.toString(), updated.isActive);
      } catch {
        // The Redis block remains in place until operator reconciliation.
        throw new AuthorizationChangeError(503, "Credit account update failed. Account access remains blocked; contact an administrator.");
      }
    }
    return updated;
  });
}
