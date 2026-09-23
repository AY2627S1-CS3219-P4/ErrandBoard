import { User } from "../models/User.js";
import { hashPassword, verifyPassword } from "../security/password.js";

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