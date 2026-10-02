import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../security/token.js";

function getToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  return authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? req.cookies?.access_token;
}

export async function requireSuperadmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getToken(req);
  if (!token) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const claims = await verifyAccessToken(token);
    if (claims.role !== "SUPERADMIN") { res.status(403).json({ error: "Superadmin access required" }); return; }
  } catch { res.status(403).json({ error: "Invalid token" }); return; }
  next();
}
