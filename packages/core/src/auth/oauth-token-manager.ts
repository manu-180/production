import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "./encryption.js";

const PROVIDER = "claude_code";

export interface OAuthTokenManager {
  saveToken(userId: string, token: string): Promise<void>;
  getToken(userId: string): Promise<string | null>;
  revokeToken(userId: string): Promise<void>;
}

export function createTokenManager(
  supabase: SupabaseClient,
  encryptionKeyHex: string,
): OAuthTokenManager {
  return {
    async saveToken(userId, token) {
      const { ciphertext, iv, tag } = encrypt(token, encryptionKeyHex);
      const { error } = await supabase.from("auth_tokens").upsert(
        {
          user_id: userId,
          provider: PROVIDER,
          encrypted_token: ciphertext,
          iv,
          tag,
          key_version: 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
      );
      if (error) throw new Error(`Failed to save token for user ${userId}: ${error.message}`);
    },

    async getToken(userId) {
      const { data, error } = await supabase
        .from("auth_tokens")
        .select("encrypted_token, iv, tag")
        .eq("user_id", userId)
        .eq("provider", PROVIDER)
        .is("revoked_at", null) // only return active (non-revoked) tokens
        .single();
      if (error || !data) return null;
      return decrypt(data.encrypted_token, data.iv, data.tag, encryptionKeyHex);
    },

    async revokeToken(userId) {
      const { error } = await supabase
        .from("auth_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("provider", PROVIDER)
        .is("revoked_at", null); // only revoke if not already revoked
      if (error) throw new Error(`Failed to revoke token for user ${userId}: ${error.message}`);
    },
  };
}

export async function createProductionTokenManager(): Promise<OAuthTokenManager> {
  const encryptionKeyHex = process.env["CONDUCTOR_ENCRYPTION_KEY"];
  if (!encryptionKeyHex) {
    throw new Error("CONDUCTOR_ENCRYPTION_KEY environment variable is not set");
  }
  // Dynamic import keeps @conductor/db out of the module graph when unit-testing
  // this file in isolation (test harness never sets Supabase env vars).
  const { createServiceClient } = await import("@conductor/db");
  return createTokenManager(createServiceClient(), encryptionKeyHex);
}
