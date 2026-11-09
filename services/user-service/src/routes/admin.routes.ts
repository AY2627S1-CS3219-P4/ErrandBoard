import { Router } from "express";
import { stats } from "../controllers/admin.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

// Admin dashboard endpoints: readable by ADMIN or SUPERADMIN (unlike the
// superadmin-only /accounts management router).
export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.get("/stats", stats);
