import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.gen.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

type CookieStore = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll?: (
    cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
  ) => void;
};

/**
 * Server Component / Route Handler client.
 * Pass the Next.js cookie store from `next/headers`.
 *
 * @example
 * import { cookies } from 'next/headers';
 * const supabase = createServerComponentClient(await cookies());
 */
export const createServerComponentClient = (cookieStore: CookieStore) =>
  createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: cookieStore.setAll ?? (() => {}),
      },
    },
  );

/**
 * Service-role client — bypasses RLS entirely.
 * Only use in trusted server contexts (worker, Edge Functions, cron jobs).
 * NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export const createServiceClient = () =>
  createSupabaseClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
