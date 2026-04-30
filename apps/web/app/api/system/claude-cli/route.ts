import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineRoute, respond } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

/**
 * GET /api/system/claude-cli — onboarding probe for the local claude CLI.
 *
 * Auth-less for the same reason `/api/auth/claude-token` is: the user is
 * configuring their environment before any authenticated context exists.
 *
 * Always returns 200; `installed` carries the binary's reachability.
 * Location is best-effort and only populated on Windows (`where claude`).
 */
export const GET = defineRoute<undefined, undefined>(
  { auth: false, rateLimit: "general" },
  async ({ traceId }) => {
    const [versionResult, whereResult] = await Promise.allSettled([
      execFileAsync("claude", ["--version"], { timeout: 5_000 }),
      execFileAsync("where", ["claude"], { timeout: 3_000 }), // Windows-only
    ]);

    const version =
      versionResult.status === "fulfilled" ? versionResult.value.stdout.trim() : undefined;

    const rawLocation =
      whereResult.status === "fulfilled" ? whereResult.value.stdout.split("\n")[0] : undefined;

    const location = typeof rawLocation === "string" ? rawLocation.trim() : undefined;

    return respond(
      {
        installed: versionResult.status === "fulfilled",
        version,
        location,
      },
      { traceId },
    );
  },
);
