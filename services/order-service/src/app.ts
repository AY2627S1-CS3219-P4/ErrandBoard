import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { errandRouter } from "./routes/order.routes.js";
import { httpLogger } from "./logger.js";


export const app = express();

app.use(httpLogger);

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
    service: "order-service",
    status: "ok",
  });
});


app.use("/errands", errandRouter);