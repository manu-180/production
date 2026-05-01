import { defineRoute, respond, respondError } from "@/lib/api";
import type { IntegrationRow, Provider } from "@/lib/validators/integrations";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

interface TestResult {
  success: boolean;
  message: string;
}

/**
 * POST /api/provider-integrations/:id/test
 * Tests the integration connection and returns { success, message }.
 *
 * Note: `provider_integrations` is not yet in the generated Supabase types.
 * The `db as any` cast will be removed once `pnpm supabase gen types` re-runs.
 */
export const POST = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ user, traceId, params }) => {
    // biome-ignore lint/suspicious/noExplicitAny: table not yet in generated types
    const { data, error } = await (user.db as any)
      .from("provider_integrations")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (error !== null || data === null) {
      return respondError("not_found", "Integration not found", { traceId });
    }

    const integration = data as IntegrationRow;
    const result = await testIntegration(integration);

    return respond(result, { traceId });
  },
);

async function testIntegration(integration: IntegrationRow): Promise<TestResult> {
  const provider = integration.provider as Provider;
  const config = integration.config;

  switch (provider) {
    case "github":
      return testGitHub(config);
    case "slack":
      return testSlack(config);
    case "discord":
      return testDiscord(config);
    case "telegram":
      return testTelegram(config);
    default: {
      const _exhaustive: never = provider;
      return { success: false, message: `Unknown provider: ${String(_exhaustive)}` };
    }
  }
}

async function testGitHub(config: Record<string, unknown>): Promise<TestResult> {
  const pat = config["pat"];
  if (typeof pat !== "string" || pat.length === 0) {
    return { success: false, message: "Personal Access Token is not configured." };
  }

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.ok) {
      const body = (await res.json()) as { login?: string };
      return {
        success: true,
        message: `Connected as @${body.login ?? "unknown"}.`,
      };
    }

    if (res.status === 401) {
      return { success: false, message: "Invalid token — GitHub returned 401 Unauthorized." };
    }

    return { success: false, message: `GitHub responded with HTTP ${res.status}.` };
  } catch {
    return { success: false, message: "Network error while reaching GitHub API." };
  }
}

async function testSlack(config: Record<string, unknown>): Promise<TestResult> {
  const webhookUrl = config["webhook_url"];
  if (typeof webhookUrl !== "string" || webhookUrl.length === 0) {
    return { success: false, message: "Webhook URL is not configured." };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Conductor integration test — you can ignore this message." }),
    });

    if (res.ok) {
      return { success: true, message: "Test message sent to Slack successfully." };
    }

    const text = await res.text().catch(() => "");
    return {
      success: false,
      message: `Slack returned HTTP ${res.status}${text ? `: ${text}` : ""}.`,
    };
  } catch {
    return { success: false, message: "Network error while reaching Slack webhook." };
  }
}

async function testDiscord(config: Record<string, unknown>): Promise<TestResult> {
  const webhookUrl = config["webhook_url"];
  if (typeof webhookUrl !== "string" || webhookUrl.length === 0) {
    return { success: false, message: "Webhook URL is not configured." };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Conductor integration test — you can ignore this message.",
      }),
    });

    // Discord returns 204 No Content on success
    if (res.ok || res.status === 204) {
      return { success: true, message: "Test message sent to Discord successfully." };
    }

    const text = await res.text().catch(() => "");
    return {
      success: false,
      message: `Discord returned HTTP ${res.status}${text ? `: ${text}` : ""}.`,
    };
  } catch {
    return { success: false, message: "Network error while reaching Discord webhook." };
  }
}

async function testTelegram(config: Record<string, unknown>): Promise<TestResult> {
  const botToken = config["bot_token"];
  if (typeof botToken !== "string" || botToken.length === 0) {
    return { success: false, message: "Bot token is not configured." };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const body = (await res.json()) as { ok?: boolean; result?: { username?: string } };

    if (res.ok && body.ok) {
      return {
        success: true,
        message: `Connected as @${body.result?.username ?? "unknown"}.`,
      };
    }

    return { success: false, message: "Invalid bot token — Telegram rejected the request." };
  } catch {
    return { success: false, message: "Network error while reaching Telegram API." };
  }
}
