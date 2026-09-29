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

export async function authenticateUser(email: string, password: string) {
  const user = await User.findOne({ email }).select("+passwordHash");

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
