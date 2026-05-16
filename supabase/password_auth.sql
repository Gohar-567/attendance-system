-- =====================================================================
-- PASSWORD AUTH — schema migration for Phase 8A
-- Paste into Supabase SQL Editor after deploying the PR.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.
-- =====================================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'slack',
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- auth_method values:
--   'slack'    — Slack OAuth only (default for everyone seeded before 8A)
--   'password' — HR issued a password; user can sign in with email + password
--   'both'     — set automatically when a 'password' user also signs in via
--                Slack OAuth, so the app knows they can use either
--
-- must_change_password = true → middleware sends the user to
-- /account/change-password until they pick a new one.

-- =====================================================================
-- SUPABASE DASHBOARD STEPS (MANUAL, run after this SQL)
-- =====================================================================
--
-- 1. Authentication → Providers → Email → toggle ON
-- 2. Authentication → Providers → Email → "Confirm email" → toggle OFF
--    (signup is admin-only; we don't want confirmation emails)
-- 3. Authentication → URL Configuration → Site URL = your Vercel URL
--    (e.g. https://attendance.vercel.app). Redirect URLs should include
--    https://<app>/auth/callback for both the OAuth flow and the
--    password-reset email link's redirect target.
-- 4. Authentication → Email Templates → "Reset password":
--      action_link should be `{{ .ConfirmationURL }}` (default works).
--      No body changes required.
-- 5. (Optional, recommended) Authentication → Rate Limits → keep the
--    defaults; Supabase already throttles failed sign-ins per IP.
--
-- After all of the above are done, the /login page's email + password
-- form, /forgot-password, and /reset-password flows will work end to end.
-- =====================================================================
