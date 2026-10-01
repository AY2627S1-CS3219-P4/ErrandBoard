import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import {
  createSessionToken,
  hashSessionToken,
} from "../security/session-token.js";

export async function registerUser(input: {
  email: string;
  username: string;
  password: string;
}) {
  const passwordHash = await hashPassword(input.password);

  const user = await User.create({
    email: input.email,
    username: input.username,
    passwordHash,
  });

  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    accountType: user.accountType,
  };
}

export async function authenticateUser(username: string, password: string) {
  const user = await User.findOne({ username }).select("+passwordHash");

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return null;
  }

  return user;
}

export async function createUserSession(
  userId: string,
  userAgent?: string,
  ipAddress?: string,
): Promise<string> {
  const rawToken = createSessionToken();

  await Session.create({
    userId,
    tokenHash: hashSessionToken(rawToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    userAgent,
    ipAddress,
  });

  return rawToken;
}

export async function revokeUserSession(rawToken: string): Promise<void> {
  await Session.updateOne(
    {
      tokenHash: hashSessionToken(rawToken),
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    },
    { $set: { revokedAt: new Date() } },
  );
}

async function findSessionUser(rawToken: string, includePassword = false) {
  const session = await Session.findOne({
    tokenHash: hashSessionToken(rawToken),
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });

  if (!session) return null;
  const query = User.findById(session.userId);
  const user = await (includePassword ? query.select("+passwordHash") : query);
  if (!user) return null;
  return user;
}

export async function getUserForActiveSession(rawToken: string) {
  const user = await findSessionUser(rawToken);
  if (!user) return null;

  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    accountType: user.accountType,
  };
}

export class AccountUpdateError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function updateOwnAccount(
  rawToken: string,
  currentPassword: string | undefined,
  change: { username: string } | { newPassword: string },
) {
  const user = await findSessionUser(rawToken, true);
  if (!user) throw new AccountUpdateError(401, "Your session has expired. Please log in again.");
  if (currentPassword !== undefined && !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AccountUpdateError(403, "Current password is incorrect.");
  }
  if ("newPassword" in change && await verifyPassword(change.newPassword, user.passwordHash)) {
    throw new AccountUpdateError(400, "Choose a different password from your current password.");
  }

  // Compare-and-set prevents an old password from authorizing a concurrent update.
  // The target ID ALWAYS comes from the authenticated session, never the request body.
  const updated = await User.findOneAndUpdate(
    { _id: user._id, passwordHash: user.passwordHash },
    "username" in change
      ? { $set: { username: change.username } }
      : { $set: { passwordHash: await hashPassword(change.newPassword) } },
    { returnDocument: "after", runValidators: true },
  );
  if (!updated) throw new AccountUpdateError(409, "Your account changed. Please log in again and retry.");
  return {
    id: updated._id.toString(), email: updated.email,
    username: updated.username, accountType: updated.accountType,
  };
}
