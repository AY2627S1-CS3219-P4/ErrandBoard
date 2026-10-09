import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";


export const app = express();

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


//app.use("/errands", errandRouter);