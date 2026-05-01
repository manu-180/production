import { defineRoute, respond, respondError } from "@/lib/api";
import { type TestNotification, testNotificationSchema } from "@/lib/validators/notifications";
import { type NotificationChannelConfig, NotificationRouter } from "@conductor/core";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/test
 * Dispatches a fake 'run.completed' event to the given channel.
 * Body: { channel }
 * Returns: { success: boolean, error?: string }
 */
export const POST = defineRoute<TestNotification>(
  { rateLimit: "mutation", bodySchema: testNotificationSchema },
  async ({ user, traceId, body }) => {
    // Load channel config from integrations table
    const { data: integrationRows, error: integError } = await user.db
      .from("integrations")
      .select("channel, config")
      .eq("user_id", user.userId);

    if (integError !== null) {
      return respondError("internal", "Failed to load channel configuration", {
        traceId,
        details: { code: integError.code },
      });
    }

    // Build the config object from stored integrations
    const channelConfig: NotificationChannelConfig = {};
    for (const row of integrationRows ?? []) {
      const cfg = row.config as Record<string, unknown>;
      switch (row.channel) {
        case "email":
          channelConfig.email = cfg as NotificationChannelConfig["email"];
          break;
        case "slack":
          channelConfig.slack = cfg as NotificationChannelConfig["slack"];
          break;
        case "discord":
          channelConfig.discord = cfg as NotificationChannelConfig["discord"];
          break;
        case "telegram":
          channelConfig.telegram = cfg as NotificationChannelConfig["telegram"];
          break;
        case "desktop":
          channelConfig.desktop = {};
          break;
        default:
          break;
      }
    }

    const testEvent = {
      type: "run.completed" as const,
      runId: "test-run-id",
      planName: "Test Plan",
      success: true,
      durationMs: 1234,
      costUsd: 0.0042,
    };

    // Build a targeted preferences list: only the requested channel
    const mockDb = {
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    {
                      user_id: user.userId,
                      event_type: "run.completed",
                      channel: body.channel,
                      enabled: true,
                      severity_threshold: "info",
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    };

    try {
      // biome-ignore lint/suspicious/noExplicitAny: mock db for test dispatch
      const router = new NotificationRouter(mockDb as any);
      await router.dispatch(testEvent, {
        userId: user.userId,
        config: channelConfig,
      });
      return respond({ success: true }, { traceId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return respond({ success: false, error: message }, { traceId });
    }
  },
);
