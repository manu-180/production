"use client";
import { createClient } from "@conductor/db";

type BrowserClient = ReturnType<typeof createClient>;
let cached: BrowserClient | null = null;

/**
 * Browser-side Supabase singleton. RSC must NOT import this module.
 * Used by realtime hooks and any client-only features that need direct DB access.
 */
export function getBrowserSupabase(): BrowserClient {
  if (cached === null) cached = createClient();
  return cached;
}
