-- =====================================================================
-- ATTENDANCE ↔ LEAVE SYNC + HR DIRECT GRANTS
--
-- ⚠️ RUN THIS BEFORE DEPLOYING THE CODE, NOT AFTER.
-- The new code writes leave_requests.source / .days on every Sick/Half
-- attendance save and on HR grants. If the code ships first, those
-- INSERTs hit columns that don't exist yet and the sync fails until this
-- runs. Forward-compatible: this migration is harmless against the old
-- code (the extra columns just sit unused), so apply it first, then deploy.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE VIEW.
-- =====================================================================
--
-- Why: the "Add entry" modal wrote Sick / Half-leave straight to
-- attendance_logs, but the balance cards read from v_employee_balances
-- (leave_allowances minus approved leave_requests). The two were
-- decoupled, so a Sick attendance entry never moved the Sick card.
--
-- Fix: leave_requests becomes the single source of truth for balances.
-- Sick / Half attendance entries now also write an 'approved'
-- leave_request tagged source='attendance', and HR can create approved
-- leave_requests directly (source='hr_manual').
-- =====================================================================

-- 1. Provenance + fractional-day support on leave_requests.
--    source values:
--      'employee'   — the normal apply→approve flow (default; matches
--                     every row seeded before this migration)
--      'attendance' — auto-synced from the Add-entry modal (Sick / Half)
--      'hr_manual'  — HR granted the leave directly, no request needed
--    days:
--      NULL         — count the whole [from_date, to_date] range (the
--                     historical behaviour; used by every multi-day
--                     request). The view falls back to the date span.
--      numeric      — an explicit day count, so a Half-leave can consume
--                     0.5 of the Casual balance instead of a full day.
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS days   NUMERIC;

CREATE INDEX IF NOT EXISTS idx_leave_requests_source_day
  ON leave_requests (employee_id, source, from_date);

-- 2. Rewrite the balance view to honour `days` when present. The only
--    change vs. the original is SUM(to_date - from_date + 1) becoming
--    SUM(COALESCE(days, to_date - from_date + 1)), so existing rows
--    (days IS NULL) are unaffected.
CREATE OR REPLACE VIEW v_employee_balances AS
SELECT
  e.id AS employee_id,
  e.full_name,
  (e.leave_allowances->>'casual')::int AS casual_allowance,
  COALESCE((SELECT SUM(COALESCE(days, to_date - from_date + 1)) FROM leave_requests
            WHERE employee_id = e.id AND type = 'casual' AND status = 'approved'
              AND EXTRACT(YEAR FROM from_date) = EXTRACT(YEAR FROM CURRENT_DATE)), 0) AS casual_used,
  (e.leave_allowances->>'sick')::int AS sick_allowance,
  COALESCE((SELECT SUM(COALESCE(days, to_date - from_date + 1)) FROM leave_requests
            WHERE employee_id = e.id AND type = 'sick' AND status = 'approved'
              AND EXTRACT(YEAR FROM from_date) = EXTRACT(YEAR FROM CURRENT_DATE)), 0) AS sick_used,
  (e.leave_allowances->>'annual')::int AS annual_allowance,
  COALESCE((SELECT SUM(COALESCE(days, to_date - from_date + 1)) FROM leave_requests
            WHERE employee_id = e.id AND type = 'annual' AND status = 'approved'
              AND EXTRACT(YEAR FROM from_date) = EXTRACT(YEAR FROM CURRENT_DATE)), 0) AS annual_used
FROM employees e
WHERE e.is_active = true;

-- =====================================================================
-- DONE. No data backfill needed — the COALESCE keeps every pre-existing
-- row counting exactly as before.
-- =====================================================================
