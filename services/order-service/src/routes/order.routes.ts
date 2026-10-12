import { Router } from "express";
import { list, mine, getById } from "../controller/order.controller.js";

export const errandRouter = Router();

//read routes
errandRouter.get("/", list);
errandRouter.get("/mine", mine);
errandRouter.get(":id", getById);
