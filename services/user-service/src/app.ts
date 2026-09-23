import express from "express";
import { authRouter } from "./routes/auth.routes.js";

export const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        service: "user-service",
        status: "ok"
    });
});



// Routes
app.use("/auth", authRouter);
