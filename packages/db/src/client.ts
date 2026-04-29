import { type SupabaseClient, createClient } from "@supabase/supabase-js";

// TODO: Replace with generated types in Phase 03 (supabase gen types)
// biome-ignore lint/suspicious/noExplicitAny: placeholder until Phase 03 generates Supabase types
export type Database = any;

let _client: SupabaseClient<Database> | null = null;

/**
 * Returns a singleton Supabase client.
 * Reads credentials from environment variables.
 * Throws if NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY are missing.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  _client = createClient<Database>(url, key);
  return _client;
}

/**
 * Service-role client for server-side operations (bypasses RLS).
 * Only use in trusted server contexts (worker, edge functions).
 */
export function getSupabaseServiceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase service credentials: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
