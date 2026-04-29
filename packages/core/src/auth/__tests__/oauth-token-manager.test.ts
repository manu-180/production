import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { encrypt } from "../encryption.js";
import { createTokenManager } from "../oauth-token-manager.js";

const VALID_KEY = "a".repeat(64);
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_TOKEN = "sk-ant-test-token-12345";

// Creates a Supabase mock where:
//   - upsert() resolves with `upsertResult`
//   - single() resolves with `singleResult`
//   - the update chain resolves with `updateResult` when awaited after eq()/is() calls
function createMockSupabase(opts: {
  upsertResult?: { data?: unknown; error?: { message: string } | null };
  singleResult?: { data?: unknown; error?: { message: string } | null };
  updateResult?: { data?: unknown; error?: { message: string } | null };
}) {
  const upsertResult = opts.upsertResult ?? { error: null };
  const singleResult = opts.singleResult ?? { data: null, error: null };
  const updateResult = opts.updateResult ?? { error: null };

  // Mock functions that track calls on the update chain
  const updateEq = vi.fn();
  const updateIs = vi.fn();

  // The update chain is modeled as a real Promise (so JS awaits it correctly)
  // with eq/is spy methods attached. Using Object.assign on a real Promise avoids
  // the biome noThenProperty lint rule that fires on plain-object `then` properties.
  const makeUpdateChain = (): Promise<typeof updateResult> & {
    eq: typeof updateEq;
    is: typeof updateIs;
  } => {
    const p = Promise.resolve(updateResult) as Promise<typeof updateResult> & {
      eq: typeof updateEq;
      is: typeof updateIs;
    };
    p.eq = updateEq;
    p.is = updateIs;
    // Each method returns the same augmented chain to allow further chaining
    updateEq.mockReturnValue(p);
    updateIs.mockReturnValue(p);
    return p;
  };

  const updateChainInstance = makeUpdateChain();

  const selectChain = {
    eq: vi.fn(),
    is: vi.fn(),
    single: vi.fn().mockResolvedValue(singleResult),
  };
  selectChain.eq.mockReturnValue(selectChain);
  selectChain.is.mockReturnValue(selectChain);

  const fromChain = {
    select: vi.fn().mockReturnValue(selectChain),
    upsert: vi.fn().mockResolvedValue(upsertResult),
    update: vi.fn().mockReturnValue(updateChainInstance),
  };

  const supabase = {
    from: vi.fn().mockReturnValue(fromChain),
    _fromChain: fromChain,
    _selectChain: selectChain,
    _updateEq: updateEq,
    _updateIs: updateIs,
  };

  return supabase as unknown as SupabaseClient & typeof supabase;
}

describe("createTokenManager", () => {
  describe("saveToken", () => {
    it("encrypts and upserts with correct shape", async () => {
      const mock = createMockSupabase({ upsertResult: { error: null } });
      const manager = createTokenManager(mock, VALID_KEY);

      await manager.saveToken(TEST_USER_ID, TEST_TOKEN);

      expect(mock.from).toHaveBeenCalledWith("auth_tokens");
      const upsertCalls = mock._fromChain.upsert.mock.calls;
      expect(upsertCalls.length).toBe(1);

      const [payload, options] = upsertCalls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(payload["user_id"]).toBe(TEST_USER_ID);
      expect(payload["provider"]).toBe("claude_code");
      expect(typeof payload["encrypted_token"]).toBe("string");
      expect(typeof payload["iv"]).toBe("string");
      expect(typeof payload["tag"]).toBe("string");
      expect(payload["key_version"]).toBe(1);
      expect(typeof payload["updated_at"]).toBe("string");
      expect(options).toEqual({ onConflict: "user_id,provider" });
      // Token value must not appear in stored form
      expect(payload["encrypted_token"]).not.toBe(TEST_TOKEN);
    });

    it("throws when supabase returns an error", async () => {
      const mock = createMockSupabase({
        upsertResult: { error: { message: "unique constraint violation" } },
      });
      const manager = createTokenManager(mock, VALID_KEY);

      await expect(manager.saveToken(TEST_USER_ID, TEST_TOKEN)).rejects.toThrow(
        "Failed to save token",
      );
    });
  });

  describe("getToken", () => {
    it("decrypts and returns plaintext token when record exists", async () => {
      const { ciphertext, iv, tag } = encrypt(TEST_TOKEN, VALID_KEY);
      const mock = createMockSupabase({
        singleResult: { data: { encrypted_token: ciphertext, iv, tag }, error: null },
      });
      const manager = createTokenManager(mock, VALID_KEY);

      const result = await manager.getToken(TEST_USER_ID);

      expect(result).toBe(TEST_TOKEN);
      expect(mock.from).toHaveBeenCalledWith("auth_tokens");
      expect(mock._fromChain.select).toHaveBeenCalledWith("encrypted_token, iv, tag");
      expect(mock._selectChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
      expect(mock._selectChain.eq).toHaveBeenCalledWith("provider", "claude_code");
      expect(mock._selectChain.is).toHaveBeenCalledWith("revoked_at", null);
    });

    it("returns null when supabase returns an error (record not found)", async () => {
      const mock = createMockSupabase({
        singleResult: { data: null, error: { message: "No rows found" } },
      });
      const manager = createTokenManager(mock, VALID_KEY);

      const result = await manager.getToken(TEST_USER_ID);

      expect(result).toBeNull();
    });

    it("returns null when supabase returns no data and no error", async () => {
      const mock = createMockSupabase({
        singleResult: { data: null, error: null },
      });
      const manager = createTokenManager(mock, VALID_KEY);

      const result = await manager.getToken(TEST_USER_ID);

      expect(result).toBeNull();
    });
  });

  describe("revokeToken", () => {
    it("calls update with revoked_at and correct user_id, provider, and revoked_at filters", async () => {
      const mock = createMockSupabase({ updateResult: { error: null } });
      const manager = createTokenManager(mock, VALID_KEY);

      const before = Date.now();
      await manager.revokeToken(TEST_USER_ID);
      const after = Date.now();

      expect(mock.from).toHaveBeenCalledWith("auth_tokens");
      expect(mock._fromChain.update).toHaveBeenCalledOnce();

      // Verify the payload contains a valid ISO timestamp for revoked_at
      const [updatePayload] = mock._fromChain.update.mock.calls[0] as [Record<string, unknown>];
      expect(typeof updatePayload["revoked_at"]).toBe("string");
      const revokedAt = new Date(updatePayload["revoked_at"] as string).getTime();
      expect(revokedAt).toBeGreaterThanOrEqual(before);
      expect(revokedAt).toBeLessThanOrEqual(after);

      // Verify the filter chain
      expect(mock._updateEq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
      expect(mock._updateEq).toHaveBeenCalledWith("provider", "claude_code");
      expect(mock._updateIs).toHaveBeenCalledWith("revoked_at", null);
    });

    it("throws when supabase returns an error on update", async () => {
      const mock = createMockSupabase({
        updateResult: { error: { message: "permission denied" } },
      });
      const manager = createTokenManager(mock, VALID_KEY);

      await expect(manager.revokeToken(TEST_USER_ID)).rejects.toThrow("Failed to revoke token");
    });
  });
});
