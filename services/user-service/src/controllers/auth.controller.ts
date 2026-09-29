import type { Request, Response } from "express";
import {
  authenticateUser,
  createUserSession,
  registerUser,
  revokeUserSession,
} from "../services/auth.service.js";
import { createAccessToken } from "../security/token.js";

export async function register(
  req: Request,
  res: Response,
): Promise<void> {
  const user = await registerUser({
    email: req.body.email,
    username: req.body.username,
    password: req.body.password,
  });

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
