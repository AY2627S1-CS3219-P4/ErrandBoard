import type { NextFunction, Request, Response } from "express";
import { errors } from "jose";
import { authorizationStore } from "../security/authorization-state.js";
import { verifyAccessToken } from "../security/token.js";

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : req.cookies?.access_token;
  if (!token) {
    res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Authentication required" });
    return;
  }

  try {
    req.user = await verifyAccessToken(token);
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      res.status(401).json({ code: "ACCESS_TOKEN_EXPIRED", error: "Access token expired" });
      return;
    }
    res.status(401).json({ code: "INVALID_ACCESS_TOKEN", error: "Invalid token" });
    return;
  }

  const decision = await authorizationStore.check(req.user);
  if (decision === "unavailable") {
    res.status(503).json({ code: "AUTHORIZATION_UNAVAILABLE", error: "Authorization temporarily unavailable" });
  } else if (decision === "inactive") {
    res.status(403).json({ code: "ACCOUNT_INACTIVE", error: "Account is inactive" });
  } else if (decision === "revoked") {
    res.status(401).json({ code: "ACCESS_REVOKED", error: "Access has been revoked. Please log in again." });
  } else {
    next();
  }
}
