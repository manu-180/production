/**
 * OpenAPI 3.1 spec for the Conductor API.
 *
 * Hand-written rather than generated from zod. We tried `@asteasolutions/zod-
 * to-openapi` first, but its zod 4 support is still patchy (apps/web is on
 * zod 4.4) and the parts that did work needed enough wrapping that the
 * literal form below is honestly easier to maintain. Schemas are kept short
 * — they describe the shape callers care about, not every internal field.
 *
 * If/when zod-to-openapi catches up, this file is a drop-in replacement: the
 * exported `getOpenApiSpec()` signature is the only contract.
 */

interface OpenApiSchema {
  type?: string;
  format?: string;
  description?: string;
  enum?: readonly string[];
  items?: OpenApiSchema | { $ref: string };
  properties?: Record<string, OpenApiSchema | { $ref: string }>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchema;
  nullable?: boolean;
  example?: unknown;
}

interface OpenApiParameter {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  description?: string;
  schema: OpenApiSchema;
}

type OpenApiResponse =
  | { $ref: string }
  | {
      description: string;
      content?: Record<string, { schema: OpenApiSchema | { $ref: string } }>;
    };

interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: OpenApiSchema | { $ref: string } }>;
  };
  responses: Record<string, OpenApiResponse>;
}

interface OpenApiPath {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  parameters?: OpenApiParameter[];
}

export interface OpenApiObject {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, OpenApiPath>;
  components: {
    schemas: Record<string, OpenApiSchema>;
    responses: Record<
      string,
      {
        description: string;
        content?: Record<string, { schema: OpenApiSchema | { $ref: string } }>;
      }
    >;
  };
  tags: Array<{ name: string; description: string }>;
}

const ref = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });
const errorRef = (name: string): { $ref: string } => ({
  $ref: `#/components/responses/${name}`,
});

const components: OpenApiObject["components"] = {
  schemas: {
    ApiError: {
      type: "object",
      required: ["error", "traceId"],
      properties: {
        error: {
          type: "string",
          enum: [
            "validation",
            "unauthorized",
            "forbidden",
            "not_found",
            "conflict",
            "rate_limited",
            "unsupported",
            "internal",
          ],
        },
        message: { type: "string" },
        traceId: { type: "string" },
        details: { type: "object", additionalProperties: true },
      },
    },
    PaginationCursor: {
      type: "string",
      description: "Opaque base64url cursor returned in `nextCursor` of list responses.",
    },
    Plan: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        user_id: { type: "string", format: "uuid" },
        name: { type: "string" },
        description: { type: "string", nullable: true },
        tags: { type: "array", items: { type: "string" } },
        is_template: { type: "boolean" },
        default_working_dir: { type: "string", nullable: true },
        default_settings: { type: "object", additionalProperties: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
      },
      required: ["id", "user_id", "name", "created_at", "updated_at"],
    },
    PromptInput: {
      type: "object",
      required: ["content"],
      properties: {
        filename: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        frontmatter: { type: "object", additionalProperties: true },
        order_index: { type: "integer", format: "int32" },
      },
    },
    PlanCreate: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        is_template: { type: "boolean" },
        default_working_dir: { type: "string" },
        default_settings: { type: "object", additionalProperties: true },
        prompts: { type: "array", items: ref("PromptInput") },
      },
    },
    PlanUpdate: {
      type: "object",
      description: "Partial update — at least one field is required.",
      properties: {
        name: { type: "string" },
        description: { type: "string", nullable: true },
        tags: { type: "array", items: { type: "string" } },
        is_template: { type: "boolean" },
        default_working_dir: { type: "string", nullable: true },
        default_settings: { type: "object", additionalProperties: true },
      },
    },
    Prompt: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        plan_id: { type: "string", format: "uuid" },
        order_index: { type: "integer" },
        title: { type: "string", nullable: true },
        filename: { type: "string", nullable: true },
        content: { type: "string" },
        content_hash: { type: "string" },
        frontmatter: { type: "object", additionalProperties: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
      },
      required: ["id", "plan_id", "order_index", "content"],
    },
    PromptReorder: {
      type: "object",
      required: ["ordered"],
      properties: {
        ordered: {
          type: "array",
          description: "Prompt UUIDs in the new order.",
          items: { type: "string", format: "uuid" },
        },
      },
    },
    Run: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        plan_id: { type: "string", format: "uuid" },
        user_id: { type: "string", format: "uuid" },
        status: {
          type: "string",
          enum: ["queued", "running", "paused", "completed", "failed", "cancelled"],
        },
        working_dir: { type: "string" },
        triggered_by: { type: "string" },
        current_prompt_index: { type: "integer", nullable: true },
        cancellation_reason: { type: "string", nullable: true },
        checkpoint_branch: { type: "string", nullable: true },
        last_heartbeat_at: { type: "string", format: "date-time", nullable: true },
        started_at: { type: "string", format: "date-time", nullable: true },
        finished_at: { type: "string", format: "date-time", nullable: true },
        total_input_tokens: { type: "integer" },
        total_output_tokens: { type: "integer" },
        total_cache_tokens: { type: "integer" },
        total_cost_usd: { type: "number" },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
      },
      required: ["id", "plan_id", "user_id", "status", "working_dir"],
    },
    RunTrigger: {
      type: "object",
      required: ["workingDir"],
      properties: {
        workingDir: { type: "string" },
        settingsOverride: { type: "object", additionalProperties: true },
        dryRun: { type: "boolean" },
      },
    },
    RunCancel: {
      type: "object",
      required: ["reason"],
      properties: { reason: { type: "string" } },
    },
    SkipPrompt: {
      type: "object",
      required: ["promptId"],
      properties: {
        promptId: { type: "string", format: "uuid" },
        reason: { type: "string" },
      },
    },
    ApprovePrompt: {
      type: "object",
      required: ["promptId", "decision"],
      properties: {
        promptId: { type: "string", format: "uuid" },
        decision: { type: "string", enum: ["approve", "reject"] },
        reason: { type: "string" },
      },
    },
    Rollback: {
      type: "object",
      description: "One of `toPromptId` or `toSha` is required.",
      properties: {
        toPromptId: { type: "string", format: "uuid" },
        toSha: { type: "string", description: "git SHA, 7-40 chars" },
      },
    },
    DecisionOverride: {
      type: "object",
      required: ["humanResponse", "requeuePrompt"],
      properties: {
        humanResponse: { type: "string" },
        requeuePrompt: {
          type: "boolean",
          description: "When true, marks the corresponding prompt_execution failed for retry.",
        },
      },
    },
    GuardianDecision: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        prompt_execution_id: { type: "string", format: "uuid" },
        decision: { type: "string", nullable: true },
        confidence: { type: "number", nullable: true },
        strategy: { type: "string", nullable: true },
        reasoning: { type: "string", nullable: true },
        question_detected: { type: "string", nullable: true },
        context_snippet: { type: "string", nullable: true },
        reviewed_by_human: { type: "boolean" },
        human_override: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
      },
    },
    OutputChunk: {
      type: "object",
      properties: {
        id: { type: "integer", format: "int64" },
        channel: { type: "string", enum: ["stdout", "stderr", "claude"] },
        content: { type: "string", nullable: true },
        prompt_execution_id: { type: "string", format: "uuid" },
        created_at: { type: "string", format: "date-time" },
      },
    },
    DiffStats: {
      type: "object",
      required: ["filesChanged", "additions", "deletions"],
      properties: {
        filesChanged: { type: "integer" },
        additions: { type: "integer" },
        deletions: { type: "integer" },
      },
    },
    DiffResponse: {
      type: "object",
      required: ["fromSha", "toSha", "diff", "stats"],
      properties: {
        fromSha: { type: "string" },
        toSha: { type: "string" },
        diff: { type: "string", description: "Unified git diff." },
        stats: ref("DiffStats") as unknown as OpenApiSchema,
      },
    },
    Settings: {
      type: "object",
      properties: {
        user_id: { type: "string", format: "uuid" },
        theme: { type: "string", enum: ["light", "dark", "system"] },
        auto_approve_low_risk: { type: "boolean" },
        default_model: { type: "string" },
        git_auto_commit: { type: "boolean" },
        git_auto_push: { type: "boolean" },
        notification_channels: { type: "object", additionalProperties: true },
        updated_at: { type: "string", format: "date-time", nullable: true },
      },
    },
    SettingsUpdate: {
      type: "object",
      description: "Partial update — at least one field is required.",
      properties: {
        theme: { type: "string", enum: ["light", "dark", "system"] },
        auto_approve_low_risk: { type: "boolean" },
        default_model: { type: "string" },
        git_auto_commit: { type: "boolean" },
        git_auto_push: { type: "boolean" },
        notification_channels: { type: "object", additionalProperties: true },
      },
    },
    HealthResponse: {
      type: "object",
      required: ["web", "db", "worker", "claudeCli"],
      properties: {
        web: { type: "string", enum: ["ok"] },
        db: { type: "string", enum: ["ok", "down"] },
        worker: { type: "string", enum: ["ok", "offline", "unknown"] },
        claudeCli: {
          type: "object",
          properties: {
            installed: { type: "boolean" },
            version: { type: "string" },
          },
          required: ["installed"],
        },
      },
    },
  },
  responses: {
    Validation: {
      description: "Validation failure (400).",
      content: { "application/json": { schema: ref("ApiError") } },
    },
    Unauthorized: {
      description: "Authentication required (401).",
      content: { "application/json": { schema: ref("ApiError") } },
    },
    NotFound: {
      description: "Resource not found or not owned by the authenticated user (404).",
      content: { "application/json": { schema: ref("ApiError") } },
    },
    Conflict: {
      description: "State transition not allowed (409).",
      content: { "application/json": { schema: ref("ApiError") } },
    },
    RateLimited: {
      description: "Rate limit exceeded (429). Inspect `Retry-After`.",
      content: { "application/json": { schema: ref("ApiError") } },
    },
    Internal: {
      description: "Unhandled server error (500).",
      content: { "application/json": { schema: ref("ApiError") } },
    },
  },
};

const idParam = (name: string, description: string): OpenApiParameter => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", format: "uuid" },
});

const cursorQueryParam: OpenApiParameter = {
  name: "cursor",
  in: "query",
  required: false,
  schema: ref("PaginationCursor") as unknown as OpenApiSchema,
};
const limitQueryParam: OpenApiParameter = {
  name: "limit",
  in: "query",
  required: false,
  schema: { type: "integer", format: "int32" },
};

const paths: Record<string, OpenApiPath> = {
  "/api/system/health": {
    get: {
      tags: ["system"],
      summary: "Liveness probe (public).",
      responses: {
        "200": {
          description: "Component health snapshot.",
          content: { "application/json": { schema: ref("HealthResponse") } },
        },
      },
    },
  },
  "/api/settings": {
    get: {
      tags: ["settings"],
      summary: "Get current user settings.",
      responses: {
        "200": {
          description: "Settings row, or defaults when none exist yet.",
          content: { "application/json": { schema: ref("Settings") } },
        },
        "401": errorRef("Unauthorized"),
      },
    },
    patch: {
      tags: ["settings"],
      summary: "Update current user settings (partial).",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("SettingsUpdate") } },
      },
      responses: {
        "200": {
          description: "Updated settings row.",
          content: { "application/json": { schema: ref("Settings") } },
        },
        "400": errorRef("Validation"),
        "401": errorRef("Unauthorized"),
      },
    },
  },
  "/api/plans": {
    get: {
      tags: ["plans"],
      summary: "List plans.",
      parameters: [
        cursorQueryParam,
        limitQueryParam,
        { name: "tag", in: "query", schema: { type: "string" } },
        { name: "search", in: "query", schema: { type: "string" } },
        { name: "is_template", in: "query", schema: { type: "string", enum: ["true", "false"] } },
      ],
      responses: {
        "200": {
          description: "Paginated list of plans owned by the user.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  plans: { type: "array", items: ref("Plan") },
                  nextCursor: ref("PaginationCursor") as unknown as OpenApiSchema,
                },
              },
            },
          },
        },
        "400": errorRef("Validation"),
      },
    },
    post: {
      tags: ["plans"],
      summary: "Create a plan, optionally with prompts.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("PlanCreate") } },
      },
      responses: {
        "201": {
          description: "Created plan.",
          content: { "application/json": { schema: ref("Plan") } },
        },
        "400": errorRef("Validation"),
      },
    },
  },
  "/api/plans/{id}": {
    parameters: [idParam("id", "Plan id.")],
    get: {
      tags: ["plans"],
      summary: "Get a plan with prompts.",
      responses: {
        "200": {
          description: "Plan + ordered prompts.",
          content: { "application/json": { schema: ref("Plan") } },
        },
        "404": errorRef("NotFound"),
      },
    },
    patch: {
      tags: ["plans"],
      summary: "Update plan fields (partial).",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("PlanUpdate") } },
      },
      responses: {
        "200": {
          description: "Updated plan.",
          content: { "application/json": { schema: ref("Plan") } },
        },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
      },
    },
    delete: {
      tags: ["plans"],
      summary: "Delete a plan.",
      responses: { "204": { description: "Deleted." }, "404": errorRef("NotFound") },
    },
  },
  "/api/plans/{id}/prompts": {
    parameters: [idParam("id", "Plan id.")],
    get: {
      tags: ["plans"],
      summary: "List prompts of a plan in order.",
      responses: {
        "200": {
          description: "Prompts ordered by order_index.",
          content: {
            "application/json": {
              schema: { type: "array", items: ref("Prompt") },
            },
          },
        },
        "404": errorRef("NotFound"),
      },
    },
    post: {
      tags: ["plans"],
      summary: "Create a prompt at the end of the plan.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("PromptInput") } },
      },
      responses: {
        "201": {
          description: "Created prompt.",
          content: { "application/json": { schema: ref("Prompt") } },
        },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
      },
    },
  },
  "/api/plans/{id}/prompts/reorder": {
    parameters: [idParam("id", "Plan id.")],
    post: {
      tags: ["plans"],
      summary: "Reorder prompts.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("PromptReorder") } },
      },
      responses: {
        "200": {
          description: "Reordered prompts.",
          content: {
            "application/json": {
              schema: { type: "array", items: ref("Prompt") },
            },
          },
        },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
      },
    },
  },
  "/api/plans/{id}/runs": {
    parameters: [idParam("id", "Plan id.")],
    post: {
      tags: ["runs"],
      summary: "Trigger a run of this plan.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("RunTrigger") } },
      },
      responses: {
        "201": {
          description: "Created run (queued).",
          content: { "application/json": { schema: ref("Run") } },
        },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
      },
    },
  },
  "/api/runs": {
    get: {
      tags: ["runs"],
      summary: "List runs (paginated).",
      parameters: [
        cursorQueryParam,
        limitQueryParam,
        {
          name: "status",
          in: "query",
          schema: {
            type: "string",
            enum: ["queued", "running", "paused", "completed", "failed", "cancelled"],
          },
        },
        { name: "planId", in: "query", schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": {
          description: "Paginated list of runs.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  runs: { type: "array", items: ref("Run") },
                  nextCursor: ref("PaginationCursor") as unknown as OpenApiSchema,
                },
              },
            },
          },
        },
        "400": errorRef("Validation"),
      },
    },
  },
  "/api/runs/{id}": {
    parameters: [idParam("id", "Run id.")],
    get: {
      tags: ["runs"],
      summary: "Get a run with executions and parent plan.",
      responses: {
        "200": {
          description: "Run + executions + plan.",
          content: { "application/json": { schema: ref("Run") } },
        },
        "404": errorRef("NotFound"),
      },
    },
  },
  "/api/runs/{id}/cancel": {
    parameters: [idParam("id", "Run id.")],
    post: {
      tags: ["runs"],
      summary: "Cancel a run (terminal).",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("RunCancel") } },
      },
      responses: {
        "200": {
          description: "Run transitioned to cancelled.",
          content: { "application/json": { schema: ref("Run") } },
        },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
        "409": errorRef("Conflict"),
      },
    },
  },
  "/api/runs/{id}/pause": {
    parameters: [idParam("id", "Run id.")],
    post: {
      tags: ["runs"],
      summary: "Pause a running run.",
      responses: {
        "200": {
          description: "Run transitioned to paused.",
          content: { "application/json": { schema: ref("Run") } },
        },
        "404": errorRef("NotFound"),
        "409": errorRef("Conflict"),
      },
    },
  },
  "/api/runs/{id}/resume": {
    parameters: [idParam("id", "Run id.")],
    post: {
      tags: ["runs"],
      summary: "Resume a paused run.",
      responses: {
        "200": {
          description: "Run transitioned to running.",
          content: { "application/json": { schema: ref("Run") } },
        },
        "404": errorRef("NotFound"),
        "409": errorRef("Conflict"),
      },
    },
  },
  "/api/runs/{id}/retry": {
    parameters: [idParam("id", "Run id.")],
    post: {
      tags: ["runs"],
      summary: "Retry a failed run.",
      responses: {
        "201": {
          description: "Re-queued run.",
          content: { "application/json": { schema: ref("Run") } },
        },
        "404": errorRef("NotFound"),
        "409": errorRef("Conflict"),
      },
    },
  },
  "/api/runs/{id}/skip-prompt": {
    parameters: [idParam("id", "Run id.")],
    post: {
      tags: ["runs"],
      summary: "Skip a prompt execution.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("SkipPrompt") } },
      },
      responses: {
        "200": { description: "Updated execution row." },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
        "409": errorRef("Conflict"),
      },
    },
  },
  "/api/runs/{id}/approve-prompt": {
    parameters: [idParam("id", "Run id.")],
    post: {
      tags: ["runs"],
      summary: "Approve or reject a prompt waiting on human approval.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("ApprovePrompt") } },
      },
      responses: {
        "200": { description: "Decision recorded." },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
        "409": errorRef("Conflict"),
      },
    },
  },
  "/api/runs/{id}/rollback": {
    parameters: [idParam("id", "Run id.")],
    post: {
      tags: ["runs"],
      summary: "Revert the working tree to a prompt's checkpoint.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("Rollback") } },
      },
      responses: {
        "200": { description: "Revert commit created." },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
        "409": errorRef("Conflict"),
      },
    },
  },
  "/api/runs/{id}/stream": {
    parameters: [idParam("id", "Run id.")],
    get: {
      tags: ["runs"],
      summary: "SSE stream of run events (fallback for clients without Realtime).",
      responses: {
        "200": {
          description: "text/event-stream — events delimited by `\\n\\n`.",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
        "404": errorRef("NotFound"),
        "429": errorRef("RateLimited"),
      },
    },
  },
  "/api/runs/{id}/logs": {
    parameters: [idParam("id", "Run id.")],
    get: {
      tags: ["runs"],
      summary: "Paginated output_chunks; supports NDJSON streaming with ?stream=true.",
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer" } },
        { name: "cursor", in: "query", schema: { type: "string" } },
        { name: "promptId", in: "query", schema: { type: "string", format: "uuid" } },
        {
          name: "channel",
          in: "query",
          schema: { type: "string", enum: ["stdout", "stderr", "claude"] },
        },
        { name: "stream", in: "query", schema: { type: "boolean" } },
      ],
      responses: {
        "200": {
          description: "Either JSON (default) or NDJSON when ?stream=true.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  chunks: { type: "array", items: ref("OutputChunk") },
                  nextCursor: { type: "string" },
                },
              },
            },
            "application/x-ndjson": { schema: { type: "string" } },
          },
        },
        "404": errorRef("NotFound"),
      },
    },
  },
  "/api/runs/{id}/decisions": {
    parameters: [idParam("id", "Run id.")],
    get: {
      tags: ["runs"],
      summary: "List guardian decisions of a run.",
      parameters: [
        { name: "reviewed", in: "query", schema: { type: "string", enum: ["true", "false"] } },
      ],
      responses: {
        "200": {
          description: "Decisions ordered by created_at.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  decisions: { type: "array", items: ref("GuardianDecision") },
                },
              },
            },
          },
        },
        "404": errorRef("NotFound"),
      },
    },
  },
  "/api/runs/{id}/decisions/{decisionId}/override": {
    parameters: [idParam("id", "Run id."), idParam("decisionId", "Guardian decision id.")],
    post: {
      tags: ["runs"],
      summary: "Record a human override for a guardian decision.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref("DecisionOverride") } },
      },
      responses: {
        "200": {
          description: "Override recorded; `requeued` indicates the prompt was re-queued.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  decision: ref("GuardianDecision") as unknown as OpenApiSchema,
                  requeued: { type: "boolean" },
                },
              },
            },
          },
        },
        "400": errorRef("Validation"),
        "404": errorRef("NotFound"),
      },
    },
  },
  "/api/runs/{id}/diff/{promptId}": {
    parameters: [idParam("id", "Run id."), idParam("promptId", "Prompt id within the plan.")],
    get: {
      tags: ["runs"],
      summary: "Unified git diff produced by a prompt.",
      responses: {
        "200": {
          description: "Diff + numstat-derived stats.",
          content: { "application/json": { schema: ref("DiffResponse") } },
        },
        "404": errorRef("NotFound"),
      },
    },
  },
};

/**
 * Snapshot of the OpenAPI 3.1 spec. Pure function — safe to call on every
 * request to /api/openapi.json without caching.
 */
export function getOpenApiSpec(): OpenApiObject {
  return {
    openapi: "3.1.0",
    info: {
      title: "Conductor API",
      version: "0.10.6",
      description:
        "Single-user orchestration API for Claude-driven plans. Auth is dev-mode (single hardcoded user); see `lib/api/auth.ts` for the swap point.",
    },
    servers: [{ url: "/", description: "Same-origin (Next.js)" }],
    tags: [
      { name: "system", description: "Liveness, version, and capability probes." },
      { name: "settings", description: "Per-user preferences." },
      { name: "plans", description: "Plan and prompt CRUD." },
      { name: "runs", description: "Run lifecycle, control, and observability." },
    ],
    paths,
    components,
  };
}
