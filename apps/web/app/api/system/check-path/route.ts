import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { defineRoute, respond } from "@/lib/api";
import { z } from "zod";

export const dynamic = "force-dynamic";

const checkPathBodySchema = z.object({
  path: z.string().trim().min(1, "path is required").max(2000),
});
type CheckPathBody = z.infer<typeof checkPathBodySchema>;

/**
 * POST /api/system/check-path — used by the run-trigger UI to validate a
 * working directory before submitting. Auth-less because the onboarding
 * page calls it before the dashboard is fully bootstrapped; the only
 * information leaked is filesystem existence flags, which is intentional.
 */
export const POST = defineRoute<CheckPathBody>(
  { auth: false, rateLimit: "general", bodySchema: checkPathBodySchema },
  async ({ traceId, body }) => {
    try {
      const info = await stat(body.path);
      const isDir = info.isDirectory();

      let isWritable = false;
      try {
        await access(body.path, constants.W_OK);
        isWritable = true;
      } catch {
        /* not writable */
      }

      let isGitRepo = false;
      try {
        await stat(join(body.path, ".git"));
        isGitRepo = true;
      } catch {
        /* not a git repo */
      }

      return respond({ exists: true, isDir, isWritable, isGitRepo }, { traceId });
    } catch {
      return respond(
        { exists: false, isDir: false, isWritable: false, isGitRepo: false },
        { traceId },
      );
    }
  },
);
