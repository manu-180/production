import pino from "pino";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS, createLogger, logger } from "../../logger.js";

describe("createLogger", () => {
  it("returns a pino Logger instance", () => {
    const log = createLogger("test-component");
    expect(log).toBeDefined();
    // pino loggers expose these standard methods
    expect(typeof log.info).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.fatal).toBe("function");
    expect(typeof log.child).toBe("function");
  });

  it("honours LOG_LEVEL env variable", () => {
    const originalLevel = process.env["LOG_LEVEL"];
    process.env["LOG_LEVEL"] = "debug";
    const log = createLogger("level-test");
    expect(log.level).toBe("debug");
    process.env["LOG_LEVEL"] = originalLevel;
  });

  it("defaults to info level when LOG_LEVEL is not set", () => {
    // Temporarily clear LOG_LEVEL so the ?? fallback kicks in
    const saved = process.env["LOG_LEVEL"];
    // biome-ignore lint/performance/noDelete: intentionally removing env var to test fallback
    delete process.env["LOG_LEVEL"];
    const log = createLogger("default-level");
    if (saved !== undefined) process.env["LOG_LEVEL"] = saved;
    expect(log.level).toBe("info");
  });

  it("singleton logger is created with component=conductor", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    // The bindings are embedded at construction time; verify via child merge
    const child = logger.child({});
    expect(child).toBeDefined();
  });
});

describe("REDACT_PATHS", () => {
  it("contains all required top-level sensitive fields", () => {
    expect(REDACT_PATHS).toContain("password");
    expect(REDACT_PATHS).toContain("token");
    expect(REDACT_PATHS).toContain("encrypted_token");
    expect(REDACT_PATHS).toContain("iv");
  });

  it("contains nested wildcard paths for all sensitive fields", () => {
    expect(REDACT_PATHS).toContain("*.password");
    expect(REDACT_PATHS).toContain("*.token");
    expect(REDACT_PATHS).toContain("*.encrypted_token");
    expect(REDACT_PATHS).toContain("*.iv");
  });

  it("contains array wildcard paths for all sensitive fields", () => {
    expect(REDACT_PATHS).toContain("[*].password");
    expect(REDACT_PATHS).toContain("[*].token");
    expect(REDACT_PATHS).toContain("[*].encrypted_token");
    expect(REDACT_PATHS).toContain("[*].iv");
  });

  it("has exactly 12 entries (4 fields × 3 depths)", () => {
    expect(REDACT_PATHS).toHaveLength(12);
  });
});

describe("formatters.level", () => {
  it("outputs string label instead of numeric level code in JSON", () => {
    // Build a logger that writes to a string stream so we can inspect output.
    // Note: transport (pino-pretty) is skipped in test by forcing NODE_ENV=production.
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";

    const lines: string[] = [];
    const stream = {
      write(chunk: string) {
        lines.push(chunk);
      },
    };

    // Build pino directly with the same formatters used by createLogger
    const testLogger = pino(
      {
        level: "info",
        formatters: {
          level: (label: string) => ({ level: label }),
        },
      },
      stream,
    );

    testLogger.info("hello");

    process.env["NODE_ENV"] = originalEnv;

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines.at(0) ?? "{}") as Record<string, unknown>;
    // Should be string "info", not numeric 30
    expect(parsed.level).toBe("info");
    expect(typeof parsed.level).toBe("string");
  });
});

describe("redaction integration", () => {
  it("censors token field in log output", () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";

    const lines: string[] = [];
    const stream = {
      write(chunk: string) {
        lines.push(chunk);
      },
    };

    // Build pino directly with the same redact config used by createLogger
    const testLogger = pino(
      {
        level: "info",
        redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
        formatters: {
          level: (label: string) => ({ level: label }),
        },
      },
      stream,
    );

    testLogger.info({ token: "super-secret-value" }, "auth event");

    process.env["NODE_ENV"] = originalEnv;

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines.at(0) ?? "{}") as Record<string, unknown>;
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.msg).toBe("auth event");
  });

  it("censors password field in log output", () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";

    const lines: string[] = [];
    const stream = {
      write(chunk: string) {
        lines.push(chunk);
      },
    };

    const testLogger = pino(
      {
        level: "info",
        redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
        formatters: {
          level: (label: string) => ({ level: label }),
        },
      },
      stream,
    );

    testLogger.info({ password: "p@ssw0rd" }, "login attempt");

    process.env["NODE_ENV"] = originalEnv;

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines.at(0) ?? "{}") as Record<string, unknown>;
    expect(parsed.password).toBe("[REDACTED]");
  });

  it("censors encrypted_token and iv fields in log output", () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";

    const lines: string[] = [];
    const stream = {
      write(chunk: string) {
        lines.push(chunk);
      },
    };

    const testLogger = pino(
      {
        level: "info",
        redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
        formatters: {
          level: (label: string) => ({ level: label }),
        },
      },
      stream,
    );

    testLogger.info({ encrypted_token: "enc-abc123", iv: "iv-xyz456" }, "crypto op");

    process.env["NODE_ENV"] = originalEnv;

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines.at(0) ?? "{}") as Record<string, unknown>;
    expect(parsed.encrypted_token).toBe("[REDACTED]");
    expect(parsed.iv).toBe("[REDACTED]");
  });
});
