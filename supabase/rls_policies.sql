-- =====================================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================================
-- Paste into Supabase SQL Editor AFTER running attendance_schema.sql.
--
-- Model:
--   employees.id == auth.users.id (Supabase auth user id).
--   On first OAuth login, the app inserts the employees row using
--   auth.uid() as the primary key. For pre-seeded employees, ensure
--   their id matches the auth.users id (or seed AFTER they log in once).
--
-- Roles (employee_role):
--   - employee   : sees only own data
--   - team_lead  : sees own team's data, approves their team's leaves
--   - hr         : sees everything, approves everything
--   - admin      : same as hr + can change roles/system settings
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they bypass the very policies
-- they support, avoiding recursion through employees policies).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS employee_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM employees WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_hr_or_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid() AND role IN ('hr', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Returns true if auth.uid() leads the team that owns `target_employee_id`.
CREATE OR REPLACE FUNCTION public.leads_team_of(target_employee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employees emp
    JOIN teams t ON t.id = emp.team_id
    WHERE emp.id = target_employee_id
      AND t.lead_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------
ALTER TABLE teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays         ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_parse_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- TEAMS
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS teams_read_all ON teams;
CREATE POLICY teams_read_all ON teams
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS teams_write_admin ON teams;
CREATE POLICY teams_write_admin ON teams
  FOR ALL TO authenticated
  USING (public.is_hr_or_admin())
  WITH CHECK (public.is_hr_or_admin());

-- ---------------------------------------------------------------------
-- EMPLOYEES
--   - everyone authenticated can read the directory (name, team, role)
--   - employees can update only their own row (limited to safe columns
--     via a trigger or via app code; RLS allows the row, app enforces fields)
--   - HR/admin can do anything
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS employees_read_directory ON employees;
CREATE POLICY employees_read_directory ON employees
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS employees_self_update ON employees;
CREATE POLICY employees_self_update ON employees
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS employees_hr_all ON employees;
CREATE POLICY employees_hr_all ON employees
  FOR ALL TO authenticated
  USING (public.is_hr_or_admin())
  WITH CHECK (public.is_hr_or_admin());

-- ---------------------------------------------------------------------
-- ATTENDANCE LOGS
--   - employee sees their own
--   - team lead sees their team's
--   - HR/admin sees everything
--   - employee can insert/update their own (web flow); slack bot uses
--     the service role and bypasses RLS
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS attendance_self_select ON attendance_logs;
CREATE POLICY attendance_self_select ON attendance_logs
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS attendance_team_select ON attendance_logs;
CREATE POLICY attendance_team_select ON attendance_logs
  FOR SELECT TO authenticated
  USING (public.leads_team_of(employee_id));

DROP POLICY IF EXISTS attendance_hr_all ON attendance_logs;
CREATE POLICY attendance_hr_all ON attendance_logs
  FOR ALL TO authenticated
  USING (public.is_hr_or_admin())
  WITH CHECK (public.is_hr_or_admin());

DROP POLICY IF EXISTS attendance_self_insert ON attendance_logs;
CREATE POLICY attendance_self_insert ON attendance_logs
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

DROP POLICY IF EXISTS attendance_self_update ON attendance_logs;
CREATE POLICY attendance_self_update ON attendance_logs
  FOR UPDATE TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

-- ---------------------------------------------------------------------
-- LEAVE REQUESTS
--   - employee sees + creates their own
--   - team lead sees + decides on their team's requests
--   - HR/admin sees + decides on everything
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS leave_self_select ON leave_requests;
CREATE POLICY leave_self_select ON leave_requests
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS leave_self_insert ON leave_requests;
CREATE POLICY leave_self_insert ON leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

DROP POLICY IF EXISTS leave_self_cancel ON leave_requests;
CREATE POLICY leave_self_cancel ON leave_requests
  FOR UPDATE TO authenticated
  USING (employee_id = auth.uid() AND status = 'pending')
  WITH CHECK (employee_id = auth.uid());

DROP POLICY IF EXISTS leave_team_select ON leave_requests;
CREATE POLICY leave_team_select ON leave_requests
  FOR SELECT TO authenticated
  USING (public.leads_team_of(employee_id));

DROP POLICY IF EXISTS leave_team_decide ON leave_requests;
CREATE POLICY leave_team_decide ON leave_requests
  FOR UPDATE TO authenticated
  USING (public.leads_team_of(employee_id))
  WITH CHECK (public.leads_team_of(employee_id));

DROP POLICY IF EXISTS leave_hr_all ON leave_requests;
CREATE POLICY leave_hr_all ON leave_requests
  FOR ALL TO authenticated
  USING (public.is_hr_or_admin())
  WITH CHECK (public.is_hr_or_admin());

-- ---------------------------------------------------------------------
-- HOLIDAYS
--   - everyone reads
--   - HR/admin writes
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS holidays_read_all ON holidays;
CREATE POLICY holidays_read_all ON holidays
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS holidays_hr_write ON holidays;
CREATE POLICY holidays_hr_write ON holidays
  FOR ALL TO authenticated
  USING (public.is_hr_or_admin())
  WITH CHECK (public.is_hr_or_admin());

-- ---------------------------------------------------------------------
-- SLACK PARSE LOG
--   - HR/admin reads (for tuning the parser)
--   - Inserts come from the bot via service role (RLS bypassed)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS parse_log_hr_select ON slack_parse_log;
CREATE POLICY parse_log_hr_select ON slack_parse_log
  FOR SELECT TO authenticated
  USING (public.is_hr_or_admin());

-- ---------------------------------------------------------------------
-- AUDIT LOG
--   - HR/admin reads everything
--   - everyone can read entries about themselves (transparency)
--   - inserts come from server-side code via service role
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS audit_self_select ON audit_log;
CREATE POLICY audit_self_select ON audit_log
  FOR SELECT TO authenticated
  USING (actor_id = auth.uid() OR target_id = auth.uid());

DROP POLICY IF EXISTS audit_hr_select ON audit_log;
CREATE POLICY audit_hr_select ON audit_log
  FOR SELECT TO authenticated
  USING (public.is_hr_or_admin());

-- =====================================================================
-- VIEWS
-- Views inherit RLS from their underlying tables when invoker rights
-- are used. v_employee_balances and v_today_status both query employees
-- + leave_requests / attendance_logs, so the policies above apply.
-- =====================================================================
ALTER VIEW v_employee_balances SET (security_invoker = true);
ALTER VIEW v_today_status      SET (security_invoker = true);

-- =====================================================================
-- DONE.
-- Test policies in SQL Editor:
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claim.sub" = '<some-employee-uuid>';
--   SELECT * FROM attendance_logs;  -- should be filtered
-- =====================================================================
