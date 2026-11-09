import type { Request, Response } from "express";
import { getUserStats } from "../services/stats.service.js";

// admin-only: platform-wide user statistics for the admin dashboard
export async function stats(_req: Request, res: Response): Promise<void> {
  res.json({ stats: await getUserStats() });
}
