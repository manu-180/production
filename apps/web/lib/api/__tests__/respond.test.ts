import { describe, expect, it } from "vitest";
import { respond, respondError, respondNoContent } from "../respond";
import { TRACE_ID_HEADER } from "../trace";

const TID = "11111111-2222-3333-4444-555555555555";

describe("respond", () => {
  it("returns 200 by default with traceId header", async () => {
    const res = respond({ ok: true }, { traceId: TID });
    expect(res.status).toBe(200);
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(TID);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("honors a custom status", () => {
    const res = respond({ id: "abc" }, { status: 201, traceId: TID });
    expect(res.status).toBe(201);
  });
});

describe("respondError", () => {
  it("maps validation -> 400 and includes details + traceId", async () => {
    const res = respondError("validation", "bad input", {
      traceId: TID,
      details: [{ path: ["name"], code: "too_small" }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "validation",
      message: "bad input",
      traceId: TID,
      details: [{ path: ["name"], code: "too_small" }],
    });
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(TID);
  });

  it.each([
    ["unauthorized" as const, 401],
    ["forbidden" as const, 403],
    ["not_found" as const, 404],
    ["conflict" as const, 409],
    ["unsupported" as const, 415],
    ["rate_limited" as const, 429],
    ["internal" as const, 500],
  ])("maps %s to status %d", (code, status) => {
    const res = respondError(code, "x", { traceId: TID });
    expect(res.status).toBe(status);
  });

  it("does not include details key when omitted", async () => {
    const res = respondError("not_found", "missing", { traceId: TID });
    const body = (await res.json()) as Record<string, unknown>;
    expect("details" in body).toBe(false);
  });

  it("allows callers to add custom headers (eg. Retry-After)", () => {
    const res = respondError("rate_limited", "too many", {
      traceId: TID,
      headers: { "Retry-After": "30" },
    });
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(TID);
  });
});

describe("respondNoContent", () => {
  it("returns 204 with no body and traceId header", () => {
    const res = respondNoContent(TID);
    expect(res.status).toBe(204);
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(TID);
  });
});
