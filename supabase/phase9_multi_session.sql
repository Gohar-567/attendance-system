-- =====================================================================
-- PHASE 9 — Multi-session work tracking + 9-AM business-day model
-- =====================================================================
-- Run AFTER attendance_schema.sql + supabase/hours_tracking.sql.
-- Idempotent where practical (IF NOT EXISTS / CREATE OR REPLACE / guarded
-- DO blocks). Verify on a Supabase BRANCH first, then run the sanity
-- checks at the bottom before promoting to production.
--
-- What this does:
--   1. business_date(ts) — the 9 AM Asia/Karachi cutoff, as a Postgres fn.
--   2. work_sessions table with a GENERATED session_date column.
--   3. recompute_attendance_hours() + triggers so attendance_logs.total_hours
--      becomes the SUM of its sessions (half=4.0, leave/sick/holiday=NULL).
--   4. Backfill one session per legacy attendance_logs row that has a
--      checkin_time, composing TIMESTAMPTZ from (date + time) in Karachi.
--   5. Drops the legacy BEFORE trigger that computed total_hours from
--      checkin_time/checkout_time (sessions own hours now).
--   6. Keeps the legacy checkin_time/checkout_time columns as a 30-day
--      safety net (dropped in a follow-up PR).
--   7. Writes an audit_log row for every backfilled session.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. business_date(ts) — 9 AM Karachi cutoff.
--    hour >= 9 → calendar date; hour < 9 → calendar date - 1 day.
--    Marked IMMUTABLE so it can drive a GENERATED column (Pakistan has no
--    DST, so the Karachi offset is a true constant — the promise holds).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION business_date(ts TIMESTAMPTZ) RETURNS DATE AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM ts AT TIME ZONE 'Asia/Karachi') >= 9
    THEN (ts AT TIME ZONE 'Asia/Karachi')::DATE
    ELSE ((ts AT TIME ZONE 'Asia/Karachi')::DATE - INTERVAL '1 day')::DATE
  END;
$$ LANGUAGE SQL IMMUTABLE;

-- ---------------------------------------------------------------------
-- 2. work_sessions — one continuous work period.
--    A session can cross midnight; it's anchored to the business day it
--    STARTED on via session_date = business_date(started_at).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_log_id UUID REFERENCES attendance_logs(id) ON DELETE CASCADE,
  -- The business day this session belongs to (9 AM Karachi cutoff).
  session_date      DATE GENERATED ALWAYS AS (business_date(started_at)) STORED,
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,             -- NULL while the session is open
  duration_hours    NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN ended_at IS NULL THEN NULL
      WHEN ended_at <= started_at THEN NULL
      WHEN EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600.0 > 16 THEN NULL
      ELSE ROUND(EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600.0, 2)
    END
  ) STORED,
  source            TEXT NOT NULL DEFAULT 'web',  -- web|slack|nudge_button|web_backdated|unclosed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_end_after_start CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_employee_date
  ON work_sessions(employee_id, session_date);

CREATE INDEX IF NOT EXISTS idx_work_sessions_log
  ON work_sessions(attendance_log_id);

CREATE INDEX IF NOT EXISTS idx_work_sessions_open
  ON work_sessions(employee_id)
  WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------
-- 3. attendance_logs.total_hours = SUM of its sessions.
-- ---------------------------------------------------------------------

-- 3a. Retire the legacy BEFORE trigger that derived total_hours from the
--     checkin_time/checkout_time TIME columns. Sessions own hours now.
DROP TRIGGER IF EXISTS attendance_compute_hours ON attendance_logs;

-- 3b. Authoritative recompute for one attendance_logs row.
--       full_leave/sick/holiday → NULL
--       half_leave              → 4.0 (fixed)
--       present/wfh/ewd         → SUM(duration_hours) of its sessions
--                                 (NULL when there are no countable hours)
CREATE OR REPLACE FUNCTION recompute_attendance_hours(p_attendance_id UUID)
RETURNS VOID AS $$
DECLARE
  v_log_type TEXT;
  v_summed   NUMERIC;
BEGIN
  IF p_attendance_id IS NULL THEN
    RETURN;
  END IF;

  SELECT type INTO v_log_type FROM attendance_logs WHERE id = p_attendance_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_log_type IN ('full_leave', 'sick', 'holiday') THEN
    UPDATE attendance_logs SET total_hours = NULL WHERE id = p_attendance_id;
    RETURN;
  ELSIF v_log_type = 'half_leave' THEN
    UPDATE attendance_logs SET total_hours = 4.0 WHERE id = p_attendance_id;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(duration_hours), 0)
  INTO v_summed
  FROM work_sessions
  WHERE attendance_log_id = p_attendance_id
    AND duration_hours IS NOT NULL;

  UPDATE attendance_logs
  SET total_hours = CASE WHEN v_summed = 0 THEN NULL ELSE v_summed END
  WHERE id = p_attendance_id;
END;
$$ LANGUAGE plpgsql;

-- 3c. BEFORE trigger on attendance_logs so leave/half/type changes keep
--     total_hours correct even for rows that have NO sessions (e.g. a
--     half_leave day). Sets NEW in place — no recursive UPDATE.
CREATE OR REPLACE FUNCTION set_attendance_total_hours()
RETURNS TRIGGER AS $$
DECLARE
  v_summed NUMERIC;
BEGIN
  IF NEW.type IN ('full_leave', 'sick', 'holiday') THEN
    NEW.total_hours := NULL;
  ELSIF NEW.type = 'half_leave' THEN
    NEW.total_hours := 4.0;
  ELSE
    SELECT COALESCE(SUM(duration_hours), 0)
    INTO v_summed
    FROM work_sessions
    WHERE attendance_log_id = NEW.id
      AND duration_hours IS NOT NULL;
    NEW.total_hours := CASE WHEN v_summed = 0 THEN NULL ELSE v_summed END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attendance_set_total_hours ON attendance_logs;
CREATE TRIGGER attendance_set_total_hours
  BEFORE INSERT OR UPDATE ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION set_attendance_total_hours();

-- 3d. AFTER trigger on work_sessions → recompute the parent log.
CREATE OR REPLACE FUNCTION trigger_recompute_attendance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_attendance_hours(OLD.attendance_log_id);
    RETURN OLD;
  ELSE
    PERFORM recompute_attendance_hours(NEW.attendance_log_id);
    IF TG_OP = 'UPDATE' AND OLD.attendance_log_id IS DISTINCT FROM NEW.attendance_log_id THEN
      PERFORM recompute_attendance_hours(OLD.attendance_log_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_sessions_recompute_hours ON work_sessions;
CREATE TRIGGER work_sessions_recompute_hours
  AFTER INSERT OR UPDATE OR DELETE ON work_sessions
  FOR EACH ROW EXECUTE FUNCTION trigger_recompute_attendance();

-- Keep updated_at fresh on session edits.
CREATE OR REPLACE FUNCTION touch_work_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_sessions_touch_updated_at ON work_sessions;
CREATE TRIGGER work_sessions_touch_updated_at
  BEFORE UPDATE ON work_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_work_session_updated_at();

-- ---------------------------------------------------------------------
-- 4. Backfill: one session per legacy row that has a checkin_time.
--    started_at = (date + checkin_time) interpreted in Karachi.
--    ended_at   = (date + checkout_time) in Karachi WHEN checkout_time is
--                 set AND strictly after checkin_time; otherwise NULL.
--    Composing same-day end mirrors the legacy TIME-subtraction semantics
--    exactly (legacy clamped negative/cross-midnight spans to NULL), so
--    SUM(total_hours) is preserved. Rows whose legacy end <= start are
--    left OPEN for HR/employee to fix via the Day Detail modal (Decision 4).
--    Only runs once — guarded so re-running the migration is a no-op.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_sessions LIMIT 1) THEN
    WITH inserted AS (
      INSERT INTO work_sessions (
        employee_id, attendance_log_id, started_at, ended_at, source
      )
      SELECT
        al.employee_id,
        al.id,
        (al.date::timestamp + al.checkin_time) AT TIME ZONE 'Asia/Karachi',
        CASE
          WHEN al.checkout_time IS NULL THEN NULL
          WHEN al.checkout_time <= al.checkin_time THEN NULL
          ELSE (al.date::timestamp + al.checkout_time) AT TIME ZONE 'Asia/Karachi'
        END,
        COALESCE(al.source, 'web')
      FROM attendance_logs al
      WHERE al.checkin_time IS NOT NULL
      RETURNING id, employee_id, attendance_log_id
    )
    INSERT INTO audit_log (actor_id, action, target_type, target_id, details)
    SELECT
      NULL,
      'backfilled_from_legacy',
      'work_session',
      i.id,
      jsonb_build_object(
        'source', 'phase_9_migration',
        'employee_id', i.employee_id,
        'attendance_log_id', i.attendance_log_id
      )
    FROM inserted i;
  END IF;
END $$;

-- 4b. Recompute total_hours for every attendance_logs row so the new
--     session-derived values land everywhere (also fixes half/leave rows).
UPDATE attendance_logs SET updated_at = updated_at;

-- ---------------------------------------------------------------------
-- 5. Legacy columns become a safety net, not a source of truth.
--    They were already nullable in this schema; the guarded DROP NOT NULL
--    keeps the migration correct even if an environment had added the
--    constraint. Drop the columns entirely in a follow-up PR after 30 days.
-- ---------------------------------------------------------------------
ALTER TABLE attendance_logs ALTER COLUMN checkin_time  DROP NOT NULL;
ALTER TABLE attendance_logs ALTER COLUMN checkout_time DROP NOT NULL;

COMMENT ON COLUMN attendance_logs.checkin_time IS
  'DEPRECATED (Phase 9): hours now come from work_sessions. Safety net — drop after 30 days.';
COMMENT ON COLUMN attendance_logs.checkout_time IS
  'DEPRECATED (Phase 9): hours now come from work_sessions. Safety net — drop after 30 days.';

-- ---------------------------------------------------------------------
-- 6. RLS for work_sessions — mirrors attendance_logs. Server actions use
--    the service role (RLS bypassed); these guard direct reads/writes.
-- ---------------------------------------------------------------------
ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_sessions_self_select ON work_sessions;
CREATE POLICY work_sessions_self_select ON work_sessions
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS work_sessions_team_select ON work_sessions;
CREATE POLICY work_sessions_team_select ON work_sessions
  FOR SELECT TO authenticated
  USING (public.leads_team_of(employee_id));

DROP POLICY IF EXISTS work_sessions_hr_all ON work_sessions;
CREATE POLICY work_sessions_hr_all ON work_sessions
  FOR ALL TO authenticated
  USING (public.is_hr_or_admin())
  WITH CHECK (public.is_hr_or_admin());

DROP POLICY IF EXISTS work_sessions_self_insert ON work_sessions;
CREATE POLICY work_sessions_self_insert ON work_sessions
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

DROP POLICY IF EXISTS work_sessions_self_update ON work_sessions;
CREATE POLICY work_sessions_self_update ON work_sessions
  FOR UPDATE TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

DROP POLICY IF EXISTS work_sessions_self_delete ON work_sessions;
CREATE POLICY work_sessions_self_delete ON work_sessions
  FOR DELETE TO authenticated
  USING (employee_id = auth.uid());

-- =====================================================================
-- SANITY CHECKS — run these on the branch after the migration.
-- =====================================================================
-- Row count matches legacy check-ins:
--   SELECT
--     (SELECT COUNT(*) FROM work_sessions)                                    AS sessions,
--     (SELECT COUNT(*) FROM attendance_logs WHERE checkin_time IS NOT NULL)   AS legacy_checkins;
--   -- sessions should equal legacy_checkins.
--
-- Hours preserved (compare to the value you captured BEFORE migrating):
--   SELECT SUM(total_hours) FROM attendance_logs;
--
-- Cross-midnight / over-long sanity (should be 0 rows):
--   SELECT * FROM work_sessions
--   WHERE ended_at IS NOT NULL
--     AND EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600 > 16;
--   -- Any rows here had bad legacy data — flag for manual HR review.
-- =====================================================================
