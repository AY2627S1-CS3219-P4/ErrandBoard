import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { settings } from "./config/settings.js";
import { createNotificationRouter, type RouterDeps } from "./routes/notification.routes.js";

export function createApp(deps: RouterDeps) {
  const app = express();

  app.use(express.json({ limit: "8kb" })); // subscriptions are ~500 bytes
  app.use(cookieParser());
  app.use(cors({ origin: settings.frontendOrigin, credentials: true }));

  app.get("/health", (_req, res) => {
    res.json({ service: "notification-service", status: "ok", push: deps.pushEnabled ? "enabled" : "disabled" });
  });

  app.use("/notifications", createNotificationRouter(deps));

  // Express 5 forwards rejected async handlers here
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled notification-service error:", error);
    if (!res.headersSent) res.status(500).json({ code: "INTERNAL_ERROR", error: "Internal error" });
  });

  return app;
}
