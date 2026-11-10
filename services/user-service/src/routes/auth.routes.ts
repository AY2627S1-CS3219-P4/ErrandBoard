import { Router } from "express";
import {
  login,
  refresh,
  logout,
  register,
  currentUser,
  changeUsername,
  changePassword,
  resendVerification,
} from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/verify-email/resend", resendVerification);
authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", currentUser);
authRouter.patch("/me/username", changeUsername);
authRouter.patch("/me/password", changePassword);
