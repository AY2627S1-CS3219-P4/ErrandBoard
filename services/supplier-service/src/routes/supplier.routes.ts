import { Router } from "express";
import {
    create,
    deactivate,
    getById,
    list,
    update
} from "../controllers/supplier.controller.js";


export const supplierRouter = Router();

//Get routes
supplierRouter.get("/", list);
supplierRouter.get("/:id", getById);


//Note the following routes require admin privileges -> insert auth functions before controller functions eg requireAuth etc...

//Post routes
supplierRouter.post("/", create);

//Patch routes
supplierRouter.patch("/", update);

//delete routes
supplierRouter.delete("/", deactivate);
