import { Router } from "express";
import {
  login,
  logout,
  register,
  currentUser,
  changeUsername,
  changePassword,
} from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/logout", logout);
authRouter.get("/me", currentUser);
authRouter.patch("/me/username", changeUsername);
authRouter.patch("/me/password", changePassword);
