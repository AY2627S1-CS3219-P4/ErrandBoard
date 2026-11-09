import { Router } from "express";
import {
    create,
    deactivate,
    getById,
    list,
    update,
    stats
} from "../controllers/supplier.controller.js";
import {
    authenticate,
    optionalAuthenticate,
    requireAdmin
} from "../middleware/auth.middleware.js"


export const supplierRouter = Router();

//Get routes (public, but admins can also see inactive suppliers)
supplierRouter.get("/", optionalAuthenticate, list);
//admin dashboard statistics — declared before "/:id" so "stats" is not captured as an id
supplierRouter.get("/stats", authenticate, requireAdmin, stats);
supplierRouter.get("/:id", optionalAuthenticate, getById);


//Note the following routes require admin privileges -> insert auth functions before controller functions eg requireAuth etc...

//Post routes
supplierRouter.post("/", authenticate, requireAdmin, create);

//Patch routes
supplierRouter.patch("/:id", authenticate, requireAdmin, update);

//delete routes
supplierRouter.delete("/:id", authenticate, requireAdmin, deactivate);
