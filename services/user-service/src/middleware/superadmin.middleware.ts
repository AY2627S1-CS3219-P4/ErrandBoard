import type { NextFunction, Request, Response } from "express";
import { isAccessTokenExpired, verifyAccessToken } from "../security/token.js";

function getToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  return authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? req.cookies?.access_token;
}

export async function requireSuperadmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getToken(req);
  if (!token) { res.status(401).json({ code: "AUTHENTICATION_REQUIRED", error: "Authentication required" }); return; }
  try {
    const claims = await verifyAccessToken(token);
    if (claims.role !== "SUPERADMIN") { res.status(403).json({ error: "Superadmin access required" }); return; }
  } catch (error) {
    if (isAccessTokenExpired(error)) {
      res.status(401).json({ code: "ACCESS_TOKEN_EXPIRED", error: "Access token expired" });
      return;
    }
    res.status(401).json({ code: "INVALID_ACCESS_TOKEN", error: "Invalid token" });
    return;
  }
  next();
}
