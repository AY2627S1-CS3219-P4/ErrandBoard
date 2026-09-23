import type { Request, Response } from "express";
import {
  authenticateUser,
  registerUser,
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

  const token = await createAccessToken(user._id.toString());

  res.cookie("access_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
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

export function logout(_req: Request, res: Response): void {
  res.clearCookie("access_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  res.status(204).send();
}