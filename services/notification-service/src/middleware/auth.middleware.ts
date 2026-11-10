import type { NextFunction, Request, Response } from "express";
import { errors } from "jose";
import { authorizationStore, AuthorizationDecision } from "../security/authorization-state.js";
import { verifyAccessToken } from "../security/token.js";

function extractToken(req: Request): string | undefined {
  // Check if the request contains an Authorization header
  const header = req.headers.authorization;

  if (header) {
    return /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  }

  // Fallback: read token from cookie
  return req.cookies?.access_token;
}

function rejectAuthorization(res: Response, decision: AuthorizationDecision): boolean {
  if (decision === "allowed") return false;
  if (decision === "unavailable") {
    res.status(503).json({ code: "AUTHORIZATION_UNAVAILABLE", error: "Authorization temporarily unavailable" });
  } else if (decision === "inactive") {
    res.status(403).json({ code: "ACCOUNT_INACTIVE", error: "Account is inactive" });
  } else {
    res.status(401).json({ code: "ACCESS_REVOKED", error: "Access has been revoked. Please log in again." });
  }
  return true;
}

// Verifies if the user has a valid access token
// Then attaches the user to the request object
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);

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

  if (rejectAuthorization(res, await authorizationStore.check(req.user))) return;


  next();
}
