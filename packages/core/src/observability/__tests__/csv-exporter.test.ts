import { describe, expect, it } from "vitest";
import { toCsv } from "../exporters/csv-exporter.js";

describe("toCsv", () => {
  it("returns empty string for an empty rows array", () => {
    expect(toCsv([])).toBe("");
  });

  it("serialises a single row with header", () => {
    const rows = [{ name: "Alice", age: 30 }];
    const csv = toCsv(rows);
    expect(csv).toBe("name,age\r\nAlice,30");
  });

  it("serialises multiple rows", () => {
    const rows = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const csv = toCsv(rows);
    expect(csv).toBe("name,age\r\nAlice,30\r\nBob,25");
  });

  it("respects the columns parameter — subset and order", () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    const csv = toCsv(rows, ["c", "a"]);
    expect(csv).toBe("c,a\r\n3,1");
  });

  it("escapes fields containing commas", () => {
    const rows = [{ value: "hello, world" }];
    const csv = toCsv(rows);
    expect(csv).toBe('value\r\n"hello, world"');
  });

  it("escapes fields containing double-quotes", () => {
    const rows = [{ value: 'say "hi"' }];
    const csv = toCsv(rows);
    expect(csv).toBe('value\r\n"say ""hi"""');
  });

  it("escapes fields containing newlines", () => {
    const rows = [{ value: "line1\nline2" }];
    const csv = toCsv(rows);
    expect(csv).toBe('value\r\n"line1\nline2"');
  });

  it("handles null and undefined values as empty strings", () => {
    const rows = [{ a: null, b: undefined }] as unknown as Record<string, unknown>[];
    const csv = toCsv(rows);
    expect(csv).toBe("a,b\r\n,");
  });

  it("serialises object values as JSON (quoted because JSON contains double-quotes)", () => {
    const rows = [{ meta: { x: 1 } }];
    const csv = toCsv(rows);
    // JSON.stringify produces {"x":1} which contains double-quote chars,
    // so RFC 4180 requires wrapping in quotes and doubling internal quotes.
    expect(csv).toBe('meta\r\n"{""x"":1}"');
  });

  it("uses the first row's keys when rows have varying keys", () => {
    const rows = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ];
    const csv = toCsv(rows);
    expect(csv.split("\r\n")[0]).toBe("a,b");
  });

  it("escapes header names that contain commas", () => {
    const rows = [{ "first,last": "Alice Smith" }];
    const csv = toCsv(rows);
    expect(csv).toBe('"first,last"\r\nAlice Smith');
  });
});
