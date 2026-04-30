import { defineRoute, respond } from "@/lib/api";
import { getOpenApiSpec } from "@/lib/openapi/spec";

export const dynamic = "force-static";

/**
 * GET /api/openapi.json — public spec used by the Scalar reference at
 * /api-docs and any downstream tooling that needs OpenAPI 3.1.
 *
 * `auth: false` — the spec describes only public path/schema metadata, no
 * secrets. Setting `dynamic = "force-static"` lets Next.js cache the response
 * indefinitely; restart bumps any new endpoints automatically because the
 * spec is built from a literal object on each fresh boot.
 */
export const GET = defineRoute<undefined, undefined>(
  { auth: false, rateLimit: "general" },
  async ({ traceId }) => respond(getOpenApiSpec(), { traceId }),
);
