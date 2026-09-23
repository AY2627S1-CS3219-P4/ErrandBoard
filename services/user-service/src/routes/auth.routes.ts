import { Router } from "express";

export const authRouter = Router();

authRouter.get("/login", (_req, res) => {
  res.status(200).json({
    service: "user-service",
    route: "/auth/login",
    status: "ready-for-authentication",
  });
});
