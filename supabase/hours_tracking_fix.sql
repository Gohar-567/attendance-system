-- =====================================================================
-- HOURS TRACKING — TIMETZ → TIME fix
-- Apply ONLY if you already ran the original hours_tracking.sql against
-- this database (which created the columns as TIMETZ). Fresh installs
-- can skip this; the updated hours_tracking.sql already uses TIME.
--
-- Why: Postgres has no operator for `time with time zone - time with
-- time zone`, so the trigger crashed with
--   "operator does not exist: time with time zone - time with time zone"
-- whenever a row's checkin_time AND checkout_time were both set.
--
-- This is safe to run multiple times — the trigger / function are
-- dropped first, the columns are ALTERed only if they're currently
-- TIMETZ, then the trigger is recreated with the correct math.
-- =====================================================================

-- 1. Drop the broken trigger + function before changing column types.
DROP TRIGGER IF EXISTS attendance_compute_hours ON attendance_logs;
DROP FUNCTION IF EXISTS compute_total_hours();

-- 2. Cast columns from TIMETZ → TIME. The USING clause drops the
--    offset cleanly; existing values that contained "+05" become plain
--    "HH:MM:SS". The DO block makes the ALTER idempotent — if the
--    columns are already TIME (e.g. you applied a partial fix earlier)
--    this is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'attendance_logs'
      AND column_name = 'checkin_time'
      AND data_type = 'time with time zone'
  ) THEN
    ALTER TABLE attendance_logs
      ALTER COLUMN checkin_time TYPE TIME USING checkin_time::TIME;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'attendance_logs'
      AND column_name = 'checkout_time'
      AND data_type = 'time with time zone'
  ) THEN
    ALTER TABLE attendance_logs
      ALTER COLUMN checkout_time TYPE TIME USING checkout_time::TIME;
  END IF;
END $$;

-- 3. Recreate the trigger function. Body is identical to the corrected
--    hours_tracking.sql — TIME - TIME → INTERVAL → hours.
CREATE OR REPLACE FUNCTION compute_total_hours()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type IN ('full_leave', 'sick', 'holiday') THEN
    NEW.total_hours := NULL;
  ELSIF NEW.type = 'half_leave' THEN
    NEW.total_hours := 4.0;
  ELSIF NEW.checkin_time IS NOT NULL AND NEW.checkout_time IS NOT NULL THEN
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

-- 4. Reattach the trigger.
CREATE TRIGGER attendance_compute_hours
  BEFORE INSERT OR UPDATE ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION compute_total_hours();

-- 5. Re-trigger across every row so total_hours is recomputed against
--    the new TIME values (and so any rows that failed to insert before
--    the migration land with a correct total once you retry them).
UPDATE attendance_logs SET id = id;
