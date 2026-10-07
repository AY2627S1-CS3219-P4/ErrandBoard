import type { NextFunction, Request, RequestHandler, Response } from "express";
import { errors } from "jose";
import { verifyAccessToken } from "../security/token.js";
import { authorizationStore, type AuthorizationDecision } from "../security/authorization-state.js";
import type { AccountType } from "../types/auth.types.js";

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

// Attaches the user to the request object if a valid access token is present,
// Invalid or missing tokens are treated as anonymous users.
// Use on public (GET) routes whose response differs for admins.
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (token) {
    try {
      req.user = await verifyAccessToken(token);
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        _res.status(401).json({ code: "ACCESS_TOKEN_EXPIRED", error: "Access token expired" });
        return;
      }
      // Invalid token
    }
    if (req.user && rejectAuthorization(_res, await authorizationStore.check(req.user))) return;
  }

  next();
}

// Creates a middleware function that only allows users whose role is in allowedRoles
// Runs after authenticate
export function requireRole(...allowedRoles: AccountType[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Access forbidden" });
      return;
    }
    next();
  }
}

// Middleware function that verifies if the user has administrative privileges
// Use after authenticate on admin-only routes
export const requireAdmin = requireRole("ADMIN", "SUPERADMIN");
