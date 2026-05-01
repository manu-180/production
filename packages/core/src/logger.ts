import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger };

export const REDACT_PATHS = [
  "password",
  "token",
  "encrypted_token",
  "iv",
  "*.password",
  "*.token",
  "*.encrypted_token",
  "*.iv",
  "[*].password",
  "[*].token",
  "[*].encrypted_token",
  "[*].iv",
];

const BASE_BINDINGS = {
  service: "conductor",
  env: process.env["NODE_ENV"] ?? "development",
};

/**
 * Create a named pino logger.
 * In non-production environments, uses pino-pretty if available.
 * Every log line includes `service`, `env`, and `component` fields.
 * Sensitive fields (token, password, encrypted_token, iv) are redacted.
 */
export function createLogger(name: string, opts?: LoggerOptions): Logger {
  const isProd = process.env["NODE_ENV"] === "production";

  const transport = !isProd
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      }
    : undefined;

  return pino({
    level: process.env["LOG_LEVEL"] ?? "info",
    ...opts,
    // Security-critical fields always applied last — opts cannot override them
    base: {
      ...(opts?.base as Record<string, unknown> | undefined),
      ...BASE_BINDINGS,
      component: name,
    },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    transport,
  });
}

/** Singleton root logger for quick usage (prefer createLogger for named loggers). */
export const logger = createLogger("conductor");
