import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types.gen";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Browser Supabase client — safe for client components.
 * Uses cookie-based session management via @supabase/ssr.
 * Call once per render; @supabase/ssr handles singleton internally.
 */
export const createClient = () =>
  createBrowserClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
