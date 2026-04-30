/**
 * Validated NEXT_PUBLIC_* env. Throws at module load if any are missing,
 * so a misconfigured deploy fails loud instead of silently going down a
 * "supabase URL undefined" rabbit hole at runtime.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const PUBLIC_ENV = {
  SUPABASE_URL: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  SUPABASE_ANON_KEY: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
} as const;
