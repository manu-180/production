import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger };

const defaultOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
};

/**
 * Create a named pino logger.
 * In non-production environments, uses pino-pretty if available.
 * Pass a `name` to identify the subsystem in log output.
 */
export function createLogger(name: string, opts?: LoggerOptions): Logger {
  const transport =
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        }
      : undefined;

  return pino({ ...defaultOptions, ...opts, name, transport });
}

/** Singleton root logger for quick usage (prefer createLogger for named loggers). */
export const logger = createLogger("conductor");
