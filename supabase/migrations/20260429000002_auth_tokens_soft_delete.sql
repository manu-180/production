-- Migration: Add soft delete support to auth_tokens
-- Purpose: Preserve audit trail when tokens are revoked

ALTER TABLE public.auth_tokens
  ADD COLUMN revoked_at timestamptz;

COMMENT ON COLUMN public.auth_tokens.revoked_at IS 'Set when token is revoked (soft delete). NULL means active.';

-- Index for filtering active tokens
CREATE INDEX auth_tokens_active_idx
  ON public.auth_tokens (user_id, provider)
  WHERE revoked_at IS NULL;
