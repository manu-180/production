#!/usr/bin/env tsx
/**
 * seed-demo.ts — Populate the local Supabase DB with demo data.
 *
 * Creates:
 *   - Demo user: demo@conductor.local (password printed to stdout)
 *   - 1 plan "Hello Conductor" with 3 prompts
 *   - 5 historical runs (completed, completed, failed, cancelled, completed)
 *   - Audit log entries for each run
 *   - User settings with desktop notifications enabled
 *
 * Usage:
 *   pnpm tsx scripts/seed-demo.ts
 *   # or via the package.json shorthand:
 *   pnpm seed:demo
 *
 * Requirements:
 *   - SUPABASE_SERVICE_ROLE_KEY set in .env
 *   - NEXT_PUBLIC_SUPABASE_URL set in .env
 *   - Local Supabase stack running (docker compose up -d supabase-db)
 */

import * as crypto from "node:crypto";
import * as path from "node:path";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// ─── env bootstrap ───────────────────────────────────────────────────────────

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`[seed-demo] ERROR: Missing required env var: ${key}`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// ─── helpers ─────────────────────────────────────────────────────────────────

const log = (msg: string) => console.error(`[seed-demo] ${msg}`);
const ok = (msg: string) => console.error(`[seed-demo] OK — ${msg}`);

function randomPassword(length = 20): string {
  return crypto
    .randomBytes(Math.ceil((length * 3) / 4))
    .toString("base64")
    .slice(0, length);
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

// ─── schema types (minimal, matching migration 20260428000001) ───────────────

interface Plan {
  id: string;
  user_id: string;
  name: string;
}

interface Prompt {
  id: string;
  plan_id: string;
  order_index: number;
}

interface Run {
  id: string;
}

// ─── demo user ───────────────────────────────────────────────────────────────

async function createDemoUser(
  supabase: SupabaseClient,
): Promise<{ userId: string; password: string }> {
  log("Creating demo user demo@conductor.local...");

  const email = "demo@conductor.local";
  const password = randomPassword();

  // Try to sign in first — if the user already exists, reuse it.
  const { data: signInData, error: signInError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: "Demo User" },
  });

  if (signInError) {
    // If user already exists, update password and retrieve id.
    if (signInError.message?.toLowerCase().includes("already")) {
      log("User exists — updating password...");
      const { data: listData } = await supabase.auth.admin.listUsers();
      const existing = listData?.users?.find((u) => u.email === email);
      if (!existing) {
        throw new Error(`Could not find existing user ${email}`);
      }
      const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, {
        password,
      });
      if (updateErr) throw updateErr;
      ok(`Demo user updated: ${email}`);
      return { userId: existing.id, password };
    }
    throw signInError;
  }

  if (!signInData.user) {
    throw new Error("createUser returned no user");
  }

  ok(`Demo user created: ${email}`);
  return { userId: signInData.user.id, password };
}

// ─── user settings ────────────────────────────────────────────────────────────

async function upsertSettings(supabase: SupabaseClient, userId: string): Promise<void> {
  log("Upserting user settings with desktop notifications enabled...");

  const { error } = await supabase.from("settings").upsert(
    {
      user_id: userId,
      notification_channels: { desktop: true },
      default_model: process.env["CONDUCTOR_DEFAULT_MODEL"] ?? "claude-sonnet-4-7",
      auto_approve_low_risk: true,
      git_auto_commit: true,
      git_auto_push: false,
      theme: "dark",
      onboarding_completed: false,
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
  ok("Settings upserted");
}

// ─── notification preferences ─────────────────────────────────────────────────

async function upsertNotificationPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  log("Adding notification preferences (desktop, run.completed + run.failed)...");

  const prefs = [
    { user_id: userId, event_type: "run.completed", channel: "desktop", enabled: true },
    { user_id: userId, event_type: "run.failed", channel: "desktop", enabled: true },
    { user_id: userId, event_type: "approval.required", channel: "desktop", enabled: true },
  ];

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(prefs, { onConflict: "user_id,event_type,channel" });

  if (error) throw error;
  ok("Notification preferences upserted");
}

// ─── plan ─────────────────────────────────────────────────────────────────────

async function createPlan(supabase: SupabaseClient, userId: string): Promise<Plan> {
  log('Creating plan "Hello Conductor"...');

  // Idempotent: check if it already exists.
  const { data: existing } = await supabase
    .from("plans")
    .select("id, user_id, name")
    .eq("user_id", userId)
    .eq("name", "Hello Conductor")
    .maybeSingle();

  if (existing) {
    ok(`Plan already exists: ${existing.id}`);
    return existing as Plan;
  }

  const { data, error } = await supabase
    .from("plans")
    .insert({
      user_id: userId,
      name: "Hello Conductor",
      description: "A simple 3-prompt demo to verify your Conductor setup.",
      tags: ["demo", "template"],
      is_template: false,
      default_settings: {},
    })
    .select("id, user_id, name")
    .single();

  if (error) throw error;
  if (!data) throw new Error("No plan returned after insert");

  ok(`Plan created: ${data.id}`);
  return data as Plan;
}

// ─── prompts ──────────────────────────────────────────────────────────────────

async function createPrompts(supabase: SupabaseClient, planId: string): Promise<Prompt[]> {
  log("Creating prompts...");

  // Skip if already seeded.
  const { data: existing } = await supabase
    .from("prompts")
    .select("id, plan_id, order_index")
    .eq("plan_id", planId)
    .order("order_index");

  if (existing && existing.length >= 3) {
    ok(`Prompts already exist (${existing.length} found)`);
    return existing as Prompt[];
  }

  // Frontmatter YAML is stored as a jsonb object per the schema.
  const promptRows = [
    {
      plan_id: planId,
      order_index: 0,
      title: "Setup check",
      filename: "01-setup-check.md",
      content: "List the files in the current directory and report how many there are.",
      frontmatter: {
        id: "hello-conductor-01",
        title: "Setup check",
        tags: ["demo"],
      },
    },
    {
      plan_id: planId,
      order_index: 1,
      title: "Create hello file",
      filename: "02-create-hello.md",
      content: 'Create a file called hello.txt with the content "Hello from Conductor!".',
      frontmatter: {
        id: "hello-conductor-02",
        title: "Create hello file",
        tags: ["demo"],
      },
    },
    {
      plan_id: planId,
      order_index: 2,
      title: "Verify and report",
      filename: "03-verify-report.md",
      content: 'Read hello.txt and confirm its contents match exactly "Hello from Conductor!".',
      frontmatter: {
        id: "hello-conductor-03",
        title: "Verify and report",
        tags: ["demo"],
      },
    },
  ];

  const { data, error } = await supabase
    .from("prompts")
    .insert(promptRows)
    .select("id, plan_id, order_index");

  if (error) throw error;
  if (!data) throw new Error("No prompts returned after insert");

  ok(`${data.length} prompts created`);
  return data as Prompt[];
}

// ─── runs + executions ────────────────────────────────────────────────────────

type RunStatus = "completed" | "failed" | "cancelled";

async function createHistoricalRun(
  supabase: SupabaseClient,
  planId: string,
  userId: string,
  prompts: Prompt[],
  status: RunStatus,
  startedHoursAgo: number,
): Promise<Run> {
  const startedAt = hoursAgo(startedHoursAgo);
  const finishedAt = hoursAgo(startedHoursAgo - 0.1); // ~6 minutes later

  const { data: run, error: runErr } = await supabase
    .from("runs")
    .insert({
      plan_id: planId,
      user_id: userId,
      working_dir: "/tmp/conductor-demo",
      status,
      started_at: startedAt,
      finished_at: finishedAt,
      triggered_by: "manual",
      current_prompt_index: status === "completed" ? prompts.length : 1,
      cancellation_reason: status === "cancelled" ? "Demo cancellation" : null,
      total_cost_usd: status === "completed" ? 0.0042 : 0.001,
      total_input_tokens: status === "completed" ? 1200 : 300,
      total_output_tokens: status === "completed" ? 480 : 120,
    })
    .select("id")
    .single();

  if (runErr) throw runErr;
  if (!run) throw new Error("No run returned after insert");

  // Create prompt_executions for each prompt in the plan.
  const execRows = prompts.map((p, idx) => {
    const execStatus =
      status === "completed"
        ? "succeeded"
        : idx === 0
          ? "succeeded"
          : status === "failed"
            ? "failed"
            : "skipped";

    return {
      run_id: run.id,
      prompt_id: p.id,
      attempt: 1,
      status: execStatus,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: 4200,
      cost_usd: 0.0014,
      input_tokens: 400,
      output_tokens: 160,
      error_message: execStatus === "failed" ? "Demo simulated failure" : null,
    };
  });

  const { error: execErr } = await supabase.from("prompt_executions").insert(execRows);

  if (execErr) throw execErr;

  return run as Run;
}

// ─── audit log ────────────────────────────────────────────────────────────────

async function writeAuditLog(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  runStatus: RunStatus,
): Promise<void> {
  const events = [
    {
      user_id: userId,
      actor: "user" as const,
      action: "run.created",
      resource_type: "run",
      resource_id: runId,
      metadata: { triggered_by: "manual" },
    },
    {
      user_id: userId,
      actor: "worker" as const,
      action: "run.started",
      resource_type: "run",
      resource_id: runId,
      metadata: { worker_id: "demo-worker-1" },
    },
    {
      user_id: userId,
      actor: "worker" as const,
      action: `run.${runStatus}`,
      resource_type: "run",
      resource_id: runId,
      metadata: { final_status: runStatus },
    },
  ];

  const { error } = await supabase.from("audit_log").insert(events);
  if (error) throw error;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error("[seed-demo] === Starting demo seed ===");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. User — password is printed to stdout so callers can capture it.
  const { userId, password } = await createDemoUser(supabase);

  // 2. Settings
  await upsertSettings(supabase, userId);

  // 3. Notification preferences
  await upsertNotificationPreferences(supabase, userId);

  // 4. Plan + prompts
  const plan = await createPlan(supabase, userId);
  const prompts = await createPrompts(supabase, plan.id);

  // 5. Historical runs: completed, completed, failed, cancelled, completed
  const runDefs: { status: RunStatus; hoursAgo: number }[] = [
    { status: "completed", hoursAgo: 48 },
    { status: "completed", hoursAgo: 36 },
    { status: "failed", hoursAgo: 24 },
    { status: "cancelled", hoursAgo: 12 },
    { status: "completed", hoursAgo: 2 },
  ];

  log(`Creating ${runDefs.length} historical runs...`);
  for (const def of runDefs) {
    const run = await createHistoricalRun(
      supabase,
      plan.id,
      userId,
      prompts,
      def.status,
      def.hoursAgo,
    );
    await writeAuditLog(supabase, userId, run.id, def.status);
    log(`  run ${run.id} — ${def.status}`);
  }
  ok(`${runDefs.length} historical runs created`);

  // Print credentials to stdout — callers capture this stream.
  process.stdout.write("\n=== Demo Credentials ===\n");
  process.stdout.write("Email   : demo@conductor.local\n");
  process.stdout.write(`Password: ${password}\n`);
  process.stdout.write("\n");

  console.error("[seed-demo] === Demo seed complete ===");
}

main().catch((err: unknown) => {
  console.error("[seed-demo] FATAL:", err);
  process.exit(1);
});
