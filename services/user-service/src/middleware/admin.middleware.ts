import type { NextFunction, Request, Response } from "express";
import { isAccessTokenExpired, verifyAccessToken } from "../security/token.js";
import { checkAuthorization } from "../security/authorization-state.js";

function getToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  return authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? req.cookies?.access_token;
}

// Admin-or-above guard (ADMIN or SUPERADMIN). Mirrors requireSuperadmin's token +
// live-authorization check, but admits both privileged roles — used by read-only admin
// endpoints such as the dashboard statistics that plain admins should also see.
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getToken(req);
  if (!token) { res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Authentication required" }); return; }
  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch (error) {
    if (isAccessTokenExpired(error)) {
      res.status(401).json({ code: "ACCESS_TOKEN_EXPIRED", error: "Access token expired" });
      return;
    }
    res.status(401).json({ code: "INVALID_ACCESS_TOKEN", error: "Invalid token" });
    return;
  }
  const decision = await checkAuthorization(claims.userId, claims.role, claims.authzVersion);
  if (decision === "unavailable") {
    res.status(503).json({ code: "AUTHORIZATION_UNAVAILABLE", error: "Authorization temporarily unavailable" });
    return;
  }
  if (decision === "inactive") {
    res.status(403).json({ code: "ACCOUNT_INACTIVE", error: "Account is inactive" });
    return;
  }
  if (decision === "revoked") {
    res.status(401).json({ code: "ACCESS_REVOKED", error: "Access has been revoked. Please log in again." });
    return;
  }
  if (claims.role !== "ADMIN" && claims.role !== "SUPERADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  req.user = claims;
  next();
}
