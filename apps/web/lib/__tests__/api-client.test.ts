import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiClientError } from "../api-client";

describe("apiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on 2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "x" }), {
          status: 200,
          headers: { "x-trace-id": "tr-1" },
        }),
      ),
    );
    const res = await apiClient.get<{ id: string }>("/api/plans/x");
    expect(res).toEqual({ id: "x" });
  });

  it("returns undefined on 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    const res = await apiClient.delete("/api/plans/x");
    expect(res).toBeUndefined();
  });

  it("throws ApiClientError with code+traceId on 4xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "not_found",
            message: "Run not found",
            traceId: "tr-2",
          }),
          { status: 404, headers: { "x-trace-id": "tr-2" } },
        ),
      ),
    );
    await expect(apiClient.get("/api/runs/missing")).rejects.toMatchObject({
      code: "not_found",
      traceId: "tr-2",
      status: 404,
    });
  });

  it("falls back to header traceId when body has none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "boom" }), {
          status: 500,
          headers: { "x-trace-id": "tr-h" },
        }),
      ),
    );
    await expect(apiClient.get("/api/x")).rejects.toMatchObject({
      code: "internal",
      traceId: "tr-h",
    });
  });

  it("wraps network failures in ApiClientError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    const err = (await apiClient.get("/api/x").catch((e) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.code).toBe("network");
  });
});
