import express from "express";
import { authRouter } from "./routes/auth.routes.js";
import { accountRouter } from "./routes/account.routes.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import { AuthorizationStateError } from "./security/authorization-state.js";

export const app = express();

app.use(express.json());
app.use(cookieParser())

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  credentials: true,
}));

app.get("/health", (_req, res) => {
    res.json({
        service: "user-service",
        status: "ok"
    });
});



// Routes
app.use("/auth", authRouter);
app.use("/accounts", accountRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof AuthorizationStateError) {
    res.status(503).json({ code: "AUTHORIZATION_UNAVAILABLE", error: error.message });
    return;
  }
  next(error);
});
