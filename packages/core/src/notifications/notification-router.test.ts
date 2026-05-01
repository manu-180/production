import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationPayload } from "./channels/base-channel.js";
import { NotificationRouter, mapSeverity } from "./notification-router.js";
import type { NotificationsDbClient } from "./preferences.js";
import type { NotificationEvent, NotificationPreference } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePreferenceRow(
  channel: string,
  eventType: string,
  severityThreshold = "info",
): NotificationPreference {
  return {
    id: `pref-${channel}`,
    user_id: "user-1",
    event_type: eventType,
    channel,
    enabled: true,
    severity_threshold: severityThreshold,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Minimal DB stub — only `from` needs to exist; the router's fetchPreferences
// is mocked directly in each test so the DB is never actually called.
function makeDb(): NotificationsDbClient {
  return {
    from: vi.fn(),
  };
}

type InternalRouter = {
  fetchPreferences(
    userId: string,
    eventType: NotificationEvent["type"],
  ): Promise<NotificationPreference[]>;
  sendViaChannel(
    channel: string,
    payload: NotificationPayload,
    config: Record<string, unknown>,
  ): Promise<void>;
};

// ─── mapSeverity ──────────────────────────────────────────────────────────────

describe("mapSeverity", () => {
  it("maps run.completed success to info", () => {
    const event: NotificationEvent = {
      type: "run.completed",
      runId: "r1",
      planName: "plan",
      success: true,
      durationMs: 1000,
      costUsd: 0.01,
    };
    expect(mapSeverity(event)).toBe("info");
  });

  it("maps run.completed failure to warning", () => {
    const event: NotificationEvent = {
      type: "run.completed",
      runId: "r1",
      planName: "plan",
      success: false,
      durationMs: 1000,
      costUsd: 0.01,
    };
    expect(mapSeverity(event)).toBe("warning");
  });

  it("maps run.failed to critical", () => {
    const event: NotificationEvent = {
      type: "run.failed",
      runId: "r1",
      planName: "plan",
      reason: "OOM",
    };
    expect(mapSeverity(event)).toBe("critical");
  });

  it("maps auth.invalid to critical", () => {
    expect(mapSeverity({ type: "auth.invalid" })).toBe("critical");
  });

  it("maps circuit.open to warning", () => {
    expect(mapSeverity({ type: "circuit.open", runId: "r1", planName: "plan" })).toBe("warning");
  });

  it("maps rate_limit.long to warning", () => {
    expect(mapSeverity({ type: "rate_limit.long", waitSeconds: 60 })).toBe("warning");
  });

  it("maps approval.required to info", () => {
    expect(
      mapSeverity({ type: "approval.required", runId: "r1", promptId: "p1", planName: "plan" }),
    ).toBe("info");
  });

  it("maps cost.threshold to warning", () => {
    expect(mapSeverity({ type: "cost.threshold", monthlyUsd: 50, thresholdUsd: 40 })).toBe(
      "warning",
    );
  });
});

// ─── NotificationRouter.dispatch ─────────────────────────────────────────────

describe("NotificationRouter.dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls email channel when preference row has channel=email", async () => {
    const router = new NotificationRouter(makeDb());
    const ir = router as unknown as InternalRouter;

    const fetchSpy = vi
      .spyOn(ir, "fetchPreferences")
      .mockResolvedValue([makePreferenceRow("email", "run.failed")]);
    const sendSpy = vi.spyOn(ir, "sendViaChannel").mockResolvedValue(undefined);

    await router.dispatch(
      { type: "run.failed", runId: "r1", planName: "plan", reason: "timeout" },
      { userId: "user-1", config: { email: { to: "user@example.com" } } },
    );

    expect(fetchSpy).toHaveBeenCalledWith("user-1", "run.failed");
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith(
      "email",
      expect.objectContaining({ severity: "critical" }),
      expect.objectContaining({ email: { to: "user@example.com" } }),
    );
  });

  it("skips channel when severity threshold is not met", async () => {
    const router = new NotificationRouter(makeDb());
    const ir = router as unknown as InternalRouter;

    vi.spyOn(ir, "fetchPreferences").mockResolvedValue([
      makePreferenceRow("email", "run.completed", "critical"),
    ]);
    const sendSpy = vi.spyOn(ir, "sendViaChannel").mockResolvedValue(undefined);

    await router.dispatch(
      {
        type: "run.completed",
        runId: "r1",
        planName: "plan",
        success: true,
        durationMs: 500,
        costUsd: 0.01,
      },
      { userId: "user-1", config: { email: { to: "user@example.com" } } },
    );

    // run.completed success → severity=info, threshold=critical → filtered out
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("handles Promise.allSettled so one failing channel does not throw", async () => {
    const router = new NotificationRouter(makeDb());
    const ir = router as unknown as InternalRouter;

    vi.spyOn(ir, "fetchPreferences").mockResolvedValue([
      makePreferenceRow("email", "run.failed"),
      makePreferenceRow("slack", "run.failed"),
    ]);
    const sendSpy = vi.spyOn(ir, "sendViaChannel").mockImplementation(async (channel) => {
      if (channel === "email") throw new Error("smtp down");
    });

    await expect(
      router.dispatch(
        { type: "run.failed", runId: "r1", planName: "plan", reason: "crash" },
        {
          userId: "user-1",
          config: { email: { to: "a@b.com" }, slack: { webhookUrl: "https://hooks.slack.com/x" } },
        },
      ),
    ).resolves.toBeUndefined();

    expect(sendSpy).toHaveBeenCalledTimes(2);
  });
});

// ─── Rate limiting ────────────────────────────────────────────────────────────

describe("NotificationRouter rate limiting", () => {
  it("sends rate_limit.long once and skips the second within 1 hour", async () => {
    const router = new NotificationRouter(makeDb());
    const ir = router as unknown as InternalRouter;

    vi.spyOn(ir, "fetchPreferences").mockResolvedValue([
      makePreferenceRow("desktop", "rate_limit.long"),
    ]);
    const sendSpy = vi.spyOn(ir, "sendViaChannel").mockResolvedValue(undefined);

    const event: NotificationEvent = { type: "rate_limit.long", waitSeconds: 120 };
    // Use a unique userId per test to avoid cross-test state pollution in the module-level map
    const ctx = { userId: "user-rl-throttle", config: {} };

    await router.dispatch(event, ctx);
    await router.dispatch(event, ctx);

    // Second dispatch is throttled — sendViaChannel called only once
    expect(sendSpy).toHaveBeenCalledOnce();
  });

  it("allows different users to each get one rate_limit.long notification", async () => {
    const router1 = new NotificationRouter(makeDb());
    const router2 = new NotificationRouter(makeDb());

    const ir1 = router1 as unknown as InternalRouter;
    const ir2 = router2 as unknown as InternalRouter;

    vi.spyOn(ir1, "fetchPreferences").mockResolvedValue([
      makePreferenceRow("desktop", "rate_limit.long"),
    ]);
    vi.spyOn(ir2, "fetchPreferences").mockResolvedValue([
      makePreferenceRow("desktop", "rate_limit.long"),
    ]);

    const send1 = vi.spyOn(ir1, "sendViaChannel").mockResolvedValue(undefined);
    const send2 = vi.spyOn(ir2, "sendViaChannel").mockResolvedValue(undefined);

    const event: NotificationEvent = { type: "rate_limit.long", waitSeconds: 120 };

    await router1.dispatch(event, { userId: "user-rl-a", config: {} });
    await router2.dispatch(event, { userId: "user-rl-b", config: {} });

    expect(send1).toHaveBeenCalledOnce();
    expect(send2).toHaveBeenCalledOnce();
  });
});
