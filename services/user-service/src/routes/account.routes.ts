import { Router } from "express";
import { listManagedAccounts, updateAccountRole, updateAccountStatus } from "../controllers/account.controller.js";
import { requireSuperadmin } from "../middleware/superadmin.middleware.js";

export const accountRouter = Router();
accountRouter.use(requireSuperadmin);
accountRouter.get("/", listManagedAccounts);
accountRouter.patch("/:id/role", updateAccountRole);
accountRouter.patch("/:id/status", updateAccountStatus);
