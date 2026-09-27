//Main application logic for supplier service

import express from "express";
import cors from "cors"; //cross-origin resource sharing
import cookieParser from "cookie-parser";

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

app.get("/health", (_req, res) => {
    res.json({
    service: "supplier-service",
    status: "ok",
  });
});