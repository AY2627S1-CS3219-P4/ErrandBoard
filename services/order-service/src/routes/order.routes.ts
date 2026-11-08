import { Router } from "express";
import {
  list,
  mine,
  getById,
  create,
  accept,
  pickup,
  deliver,
  complete,
  cancelByRequester,
  cancelByCourier,
  dispute,
  listDisputes,
  resolveRefund,
  resolveTransfer
} from "../controller/order.controller.js";
import { authenticate, requireAdmin } from "../middleware/auth.middleware.js";

export const errandRouter = Router();

// every errand route requires a logged-in user
errandRouter.use(authenticate);

//read routes
errandRouter.get("/", list);
errandRouter.get("/mine", mine);
// admin dispute queue — declared before "/:id" so "disputes" is not captured as an id
errandRouter.get("/disputes", requireAdmin, listDisputes);
errandRouter.get("/:id", getById);

//create routes
errandRouter.post("/", create);

//status update routes (ownership is checked in the service)
errandRouter.post("/:id/accept", accept);
errandRouter.post("/:id/pickup", pickup);
errandRouter.post("/:id/deliver", deliver);
errandRouter.post("/:id/complete", complete);
errandRouter.post("/:id/cancel", cancelByRequester);
errandRouter.post("/:id/courier-cancel", cancelByCourier);

//dispute: requester raises it, admins resolve it
errandRouter.post("/:id/dispute", dispute);
errandRouter.post("/:id/resolve-refund", requireAdmin, resolveRefund);
errandRouter.post("/:id/resolve-transfer", requireAdmin, resolveTransfer);
