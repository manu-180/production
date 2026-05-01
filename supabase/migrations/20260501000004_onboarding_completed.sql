-- Migration: 20260501000004_onboarding_completed.sql
-- Add onboarding_completed flag to settings table

ALTER TABLE public.settings
ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.settings.onboarding_completed IS 'Whether the user has completed the onboarding tour';
