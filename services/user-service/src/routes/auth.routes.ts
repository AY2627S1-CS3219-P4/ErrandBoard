import { Router } from "express";
import {
  login,
  logout,
  register,
  currentUser,
} from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/logout", logout);
authRouter.get("/me", currentUser);
