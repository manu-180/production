import { describe, expect, it } from "vitest";
import { toJson, toJsonL } from "../exporters/json-exporter.js";

describe("toJson", () => {
  it("serialises an empty array", () => {
    expect(toJson([])).toBe("[]");
  });

  it("returns a pretty-printed JSON array", () => {
    const rows = [{ a: 1 }, { b: 2 }];
    const result = toJson(rows);
    // Must be valid JSON and pretty-printed (indented with 2 spaces)
    expect(JSON.parse(result)).toEqual(rows);
    expect(result).toContain("\n");
    expect(result).toContain("  ");
  });

  it("round-trips complex objects", () => {
    const rows = [{ id: "abc", nested: { x: [1, 2, 3] }, nullable: null }];
    expect(JSON.parse(toJson(rows))).toEqual(rows);
  });
});

describe("toJsonL", () => {
  it("returns empty string for an empty array", () => {
    expect(toJsonL([])).toBe("");
  });

  it("returns one line per row", () => {
    const rows = [{ a: 1 }, { b: 2 }];
    const result = toJsonL(rows);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "null")).toEqual({ a: 1 });
    expect(JSON.parse(lines[1] ?? "null")).toEqual({ b: 2 });
  });

  it("each line is compact JSON (no internal newlines)", () => {
    const rows = [{ key: "value with spaces", num: 42 }];
    const result = toJsonL(rows);
    expect(result.split("\n")).toHaveLength(1);
    expect(JSON.parse(result)).toEqual(rows[0]);
  });

  it("round-trips an array of objects", () => {
    const rows = [
      { a: 1, b: "two" },
      { a: 3, b: "four" },
    ];
    const parsed = toJsonL(rows)
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(parsed).toEqual(rows);
  });
});
