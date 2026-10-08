import express from "express";
import cors from "cors"; //cross-origin resource sharing
import cookieParser from "cookie-parser";
import { creditRouter } from "./routes/credit.routes.js";

export const app = express();

//enable functions 
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  }),
);

//status route
app.get("/health", (_req, res) => {
    res.json({
    service: "credit-service",
    status: "ok",
  });
});

//other routes
app.use("/credit", creditRouter);
