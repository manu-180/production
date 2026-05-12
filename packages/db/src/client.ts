import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types.gen.js";

// Direct literal access required — Next.js's `webpack.DefinePlugin` matches
// the AST node `process.env.NEXT_PUBLIC_*` and inlines the value at build
// time. Aliasing or bracket-notation breaks that replacement and leaves the
// browser bundle reading from an undefined `process.env`. The inline cast
// below suppresses TS4111 (`noPropertyAccessFromIndexSignature`) without
// changing the emitted JS — TS casts are erased before webpack runs.
type NextPublicEnv = NodeJS.ProcessEnv & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

export const createClient = () =>
  createBrowserClient<Database>(
    (process.env as NextPublicEnv).NEXT_PUBLIC_SUPABASE_URL ?? "",
    (process.env as NextPublicEnv).NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
