-- Migration: Add AES-256-GCM authentication fields to auth_tokens
-- Purpose: Support authenticated encryption with tag and key versioning for token storage

ALTER TABLE public.auth_tokens
  ADD COLUMN tag         text    NOT NULL DEFAULT '',
  ADD COLUMN key_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.auth_tokens.tag         IS 'AES-256-GCM authentication tag (base64 encoded) for verifying encrypted token integrity';
COMMENT ON COLUMN public.auth_tokens.key_version IS 'Encryption key version used for this token (supports future key rotation)';
