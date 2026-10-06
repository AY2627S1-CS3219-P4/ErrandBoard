import type { Request, Response } from "express";
import {
  authenticateUser,
  createUserSession,
  getUserForActiveSession,
  registerUser,
  revokeUserSession,
  rotateUserSession,
  updateOwnAccount,
  AccountUpdateError,
} from "../services/auth.service.js";
import { createAccessToken } from "../security/token.js";
import { AuthorizationChangeError } from "../services/authorization.service.js";
import { validateRegistration, validatePassword, validUsername, validCredential } from "../validators/registration.validator.js";

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
  if (!validUsername(req.body?.username) || !validCredential(req.body?.password)) {
    res.status(400).json({ error: "Enter a valid username and password." });
    return;
  }
  const user = await authenticateUser(req.body.username, req.body.password);

  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const accessToken = await createAccessToken(
    user._id.toString(),
    user.accountType,
    user.authzVersion ?? 0,
  );
  const sessionToken = await createUserSession(
    user._id.toString(),
    user.authzVersion ?? 0,
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

export async function refresh(req: Request, res: Response): Promise<void> {
  const sessionToken = req.cookies?.session_token;
  if (typeof sessionToken !== "string" || !sessionToken) {
    res.status(401).json({ code: "REFRESH_SESSION_INVALID", error: "Your session has expired. Please log in again." });
    return;
  }

  const rotated = await rotateUserSession(sessionToken);
  if (!rotated) {
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
    res.status(401).json({ code: "REFRESH_SESSION_INVALID", error: "Your session has expired. Please log in again." });
    return;
  }

  const accessToken = await createAccessToken(rotated.user.id, rotated.user.accountType, rotated.authzVersion);
  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
  res.cookie("session_token", rotated.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.max(0, rotated.expiresAt.getTime() - Date.now()),
    path: "/",
  });
  res.json({ user: rotated.user });
}

export async function currentUser(req: Request, res: Response): Promise<void> {
  const sessionToken = req.cookies?.session_token;
  if (typeof sessionToken !== "string") {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const user = await getUserForActiveSession(sessionToken);
  if (!user) {
    res.status(401).json({ error: "Session is invalid or expired" });
    return;
  }

  res.json({ user });
}

async function updateAccount(req: Request, res: Response, kind: "username" | "password"): Promise<void> {
  const token = req.cookies?.session_token;
  if (typeof token !== "string" || !token) {
    res.status(401).json({ error: "Not authenticated. Please log in again." });
    return;
  }
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "Expected a JSON object containing the account change." });
    return;
  }
  if (kind === "password" && !validCredential(body.currentPassword)) {
    res.status(400).json({ error: "Enter your current password to confirm this change." });
    return;
  }
  if (kind === "username" && !validUsername(body.username)) {
    res.status(400).json({ error: "Username must be 3–30 letters, numbers, or underscores." });
    return;
  }
  if (kind === "password") {
    const error = typeof body.newPassword === "string" ? validatePassword(body.newPassword) : "Enter a new password.";
    if (error) { res.status(400).json({ error }); return; }
  }

  try {
    const user = await updateOwnAccount(token, kind === "password" ? body.currentPassword : undefined,
      kind === "username" ? { username: body.username } : { newPassword: body.newPassword });
    if (kind === "password") {
      for (const name of ["access_token", "session_token"]) {
        res.clearCookie(name, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
        });
      }
    }
    res.json({ user, message: kind === "password"
      ? "Password updated. Please log in again on every device."
      : "Username updated. Use your new username the next time you log in." });
  } catch (error) {
    if (error instanceof AccountUpdateError || error instanceof AuthorizationChangeError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const fields = duplicateRegistrationFields(error);
    if (fields) {
      res.status(409).json({ error: fields.username ?? "Those account details are already in use.", fields });
      return;
    }
    throw error;
  }
}

export const changeUsername = (req: Request, res: Response) => updateAccount(req, res, "username");
export const changePassword = (req: Request, res: Response) => updateAccount(req, res, "password");
