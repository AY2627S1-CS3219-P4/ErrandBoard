import { Router } from "express";
import {
  login,
  logout,
  register,
} from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/logout", logout);
