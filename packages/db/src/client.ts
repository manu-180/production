import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types.gen.js";

// Direct access required — Next.js only statically replaces process.env.NEXT_PUBLIC_*
// when accessed as a literal, not via dynamic process.env[name].
export const createClient = () =>
  createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
