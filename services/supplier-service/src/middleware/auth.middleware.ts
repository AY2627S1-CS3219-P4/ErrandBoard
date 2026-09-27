import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifyAccessToken } from "../security/token.js";
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

// Verifies if the user has a valid access token
// Then attaches the user to the request object
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    req.user = await verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
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
export const requireAdmin = requireRole("ADMIN");