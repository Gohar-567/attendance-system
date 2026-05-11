-- =====================================================================
-- NOTIFICATION PREFERENCES
-- Adds per-employee opt-out toggles for the Phase 6 cron DMs.
-- Paste into Supabase SQL Editor; runs idempotently.
-- =====================================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS nudge_enabled BOOLEAN NOT NULL DEFAULT true;

-- New rows already get the defaults above. Existing rows are auto-true.
-- The /settings page lets each employee flip their own values; the existing
-- employees_self_update RLS policy already allows the row UPDATE.
