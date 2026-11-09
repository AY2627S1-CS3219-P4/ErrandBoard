import pino from "pino";
import { pinoHttp } from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

// Structured JSON logger. In production, raw JSON lines go to stdout and are
// shipped to CloudWatch Logs by the ECS awslogs driver, where Logs Insights
// parses the fields automatically. In development, pino-pretty gives readable output.
export const logger = pino({
  name: "supplier-service",
  level: process.env.LOG_LEVEL ?? (isTest ? "silent" : isProd ? "info" : "debug"),
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
        },
      }),
  // Strip anything sensitive that might appear in a logged object.
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "password", "*.password", "token", "*.token"],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Express request-logging middleware. Attaches a child logger (with a request id)
// as `req.log`, and emits one structured line per request with method, path,
// status and latency. Health checks are not logged to keep the stream clean.
export const httpLogger = pinoHttp({
  logger,
  autoLogging: { ignore: (req: IncomingMessage) => req.url === "/health" },
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) =>
    err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
});
