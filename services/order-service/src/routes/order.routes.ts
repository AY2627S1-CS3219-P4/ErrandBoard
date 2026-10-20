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
  cancelByCourier
} from "../controller/order.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

export const errandRouter = Router();

// every errand route requires a logged-in user
errandRouter.use(authenticate);

//read routes
errandRouter.get("/", list);
errandRouter.get("/mine", mine);
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
