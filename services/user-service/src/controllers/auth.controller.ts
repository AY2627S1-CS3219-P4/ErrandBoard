import type { Request, Response } from "express";
import {
  authenticateUser,
  createUserSession,
  registerUser,
  revokeUserSession,
} from "../services/auth.service.js";
import { createAccessToken } from "../security/token.js";
import { validateRegistration } from "../validators/registration.validator.js";

function duplicateRegistrationFields(error: unknown): Record<string, string> | null {
  if (
    typeof error !== "object" || error === null ||
    !("code" in error) || error.code !== 11000
  ) return null;

  const fields: Record<string, string> = {};
  const keyPattern = "keyPattern" in error && typeof error.keyPattern === "object" && error.keyPattern !== null
    ? error.keyPattern as Record<string, unknown>
    : {};
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const duplicateFields = new Set([...Object.keys(keyPattern), ...["email", "username"].filter((field) => message.includes(`${field}_1`))]);

  for (const field of duplicateFields) {
    if (field === "email") fields.email = "This email is already registered. Try logging in instead.";
    if (field === "username") fields.username = "This username is already taken. Please choose another.";
  }

  return Object.keys(fields).length > 0
    ? fields
    : { registration: "An account with these details already exists." };
}

export async function register(
  req: Request,
  res: Response,
): Promise<void> {
  const validation = validateRegistration(req.body);
  if (!validation.valid) {
    res.status(400).json({
      error: "Invalid registration input",
      fields: validation.errors,
    });
    return;
  }

  let user;
  try {
    user = await registerUser(validation.data);
  } catch (error) {
    const fields = duplicateRegistrationFields(error);
    if (!fields) throw error;
    res.status(409).json({
      error: "Registration conflict",
      fields,
    });
    return;
  }

  res.status(201).json({ user });
}

export async function login(
  req: Request,
  res: Response,
): Promise<void> {
  const user = await authenticateUser(
    req.body.email,
    req.body.password,
  );

  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const accessToken = await createAccessToken(
    user._id.toString(),
    user.accountType,
  );
  const sessionToken = await createUserSession(
    user._id.toString(),
    req.get("user-agent"),
    req.ip,
  );

  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });

  res.cookie("session_token", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({
    user: {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      accountType: user.accountType,
    },
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const sessionToken = req.cookies?.session_token;

  if (typeof sessionToken === "string") {
    await revokeUserSession(sessionToken);
  }

  res.clearCookie("access_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  res.clearCookie("session_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  res.status(204).send();
}
