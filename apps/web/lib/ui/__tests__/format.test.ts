import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCostUsd,
  formatDuration,
  formatRelativeTime,
  formatTokens,
} from "../format";

describe("formatTokens", () => {
  it("formats below 1k as integer", () => expect(formatTokens(842)).toBe("842"));
  it("formats above 1k with suffix", () => expect(formatTokens(12_345)).toBe("12.3k"));
  it("formats millions", () => expect(formatTokens(2_500_000)).toBe("2.5M"));
});

describe("formatCostUsd", () => {
  it("formats with 4 decimals below $1", () =>
    expect(formatCostUsd(0.0123)).toBe("$0.0123"));
  it("formats with 2 decimals above $1", () =>
    expect(formatCostUsd(12.5)).toBe("$12.50"));
  it("handles zero", () => expect(formatCostUsd(0)).toBe("$0.0000"));
});

describe("formatDuration", () => {
  it("formats seconds", () => expect(formatDuration(45_000)).toBe("45s"));
  it("formats minutes:seconds", () => expect(formatDuration(125_000)).toBe("2m 5s"));
  it("formats hours", () => expect(formatDuration(3_725_000)).toBe("1h 2m"));
});

describe("formatRelativeTime", () => {
  it("returns 'just now' under 10s", () => {
    expect(formatRelativeTime(new Date(Date.now() - 5_000))).toBe("just now");
  });
  it("returns minutes ago", () => {
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60_000))).toBe("5m ago");
  });
  it("returns hours ago", () => {
    expect(formatRelativeTime(new Date(Date.now() - 3 * 3600_000))).toBe("3h ago");
  });
});

describe("formatBytes", () => {
  it("formats bytes", () => expect(formatBytes(500)).toBe("500 B"));
  it("formats KB", () => expect(formatBytes(2048)).toBe("2.0 KB"));
  it("formats MB", () => expect(formatBytes(5_242_880)).toBe("5.0 MB"));
});
