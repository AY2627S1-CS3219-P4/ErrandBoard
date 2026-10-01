import { Router } from "express";
import {
    create,
    deactivate,
    getById,
    list,
    update
} from "../controllers/supplier.controller.js";
import {
    authenticate,
    requireAdmin
} from "../middleware/auth.middleware.js"


export const supplierRouter = Router();

//Get routes
supplierRouter.get("/", list);
supplierRouter.get("/:id", getById);


//Note the following routes require admin privileges -> insert auth functions before controller functions eg requireAuth etc...

//Post routes
supplierRouter.post("/", authenticate, requireAdmin, create);

//Patch routes
supplierRouter.patch("/:id", authenticate, requireAdmin, update);

//delete routes
supplierRouter.delete("/:id", authenticate, requireAdmin, deactivate);
