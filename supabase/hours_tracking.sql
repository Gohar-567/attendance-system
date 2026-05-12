-- =====================================================================
-- HOURS TRACKING — schema migration for Phase 7C
-- Paste into Supabase SQL Editor after deploying the PR.
-- Idempotent (uses ADD COLUMN IF NOT EXISTS and CREATE OR REPLACE).
--
-- Columns are plain TIME (no timezone). The whole app operates in
-- Asia/Karachi, so the date column is all the calendar context we need.
-- TIMETZ caused the trigger to crash because Postgres has no
-- `time with time zone - time with time zone` operator.
-- =====================================================================

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS checkin_time  TIME,
  ADD COLUMN IF NOT EXISTS checkout_time TIME,
  ADD COLUMN IF NOT EXISTS total_hours   NUMERIC(4,2);

-- Index for HR aggregate queries (only rows with hours).
CREATE INDEX IF NOT EXISTS idx_attendance_logs_hours
  ON attendance_logs(date, total_hours)
  WHERE total_hours IS NOT NULL;

-- =====================================================================
-- compute_total_hours()
--   - full_leave / sick / holiday → NULL
--   - half_leave                  → 4.0 (fixed, regardless of times)
--   - present / wfh / ewd         → (checkout - checkin) hours when both
--                                   are set; otherwise NULL
--   - Negative or > 16 hour shifts are clamped to NULL so HR can spot
--     them and edit manually
-- =====================================================================
CREATE OR REPLACE FUNCTION compute_total_hours()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type IN ('full_leave', 'sick', 'holiday') THEN
    NEW.total_hours := NULL;
  ELSIF NEW.type = 'half_leave' THEN
    NEW.total_hours := 4.0;
  ELSIF NEW.checkin_time IS NOT NULL AND NEW.checkout_time IS NOT NULL THEN
    -- TIME - TIME → INTERVAL; EXTRACT(EPOCH …) → seconds → hours.
    NEW.total_hours := EXTRACT(EPOCH FROM (NEW.checkout_time - NEW.checkin_time)) / 3600.0;
    IF NEW.total_hours < 0 OR NEW.total_hours > 16 THEN
      NEW.total_hours := NULL;
    END IF;
  ELSE
    NEW.total_hours := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop/recreate so re-running the migration always lands on the right
-- function body.
DROP TRIGGER IF EXISTS attendance_compute_hours ON attendance_logs;
CREATE TRIGGER attendance_compute_hours
  BEFORE INSERT OR UPDATE ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION compute_total_hours();

-- =====================================================================
-- Backfill: run the trigger across every existing row so historical
-- half_leave entries get total_hours = 4.0 and any rows with pre-existing
-- checkin/checkout times pick up their computed value.
-- =====================================================================
UPDATE attendance_logs SET id = id;
