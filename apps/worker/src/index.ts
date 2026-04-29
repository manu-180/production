import pino from "pino";
import "dotenv/config";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
});

logger.info("conductor worker starting");

const HEARTBEAT_INTERVAL_MS = 30_000;

setInterval(() => {
  logger.info("worker alive");
}, HEARTBEAT_INTERVAL_MS);

logger.info("conductor worker ready");
