import { createAdminClient } from "@/lib/supabase/admin";
import {
  type AttendanceLog,
  type BalanceRow,
  type Holiday,
} from "@/lib/attendance";
import { firstOfMonthISO, lastOfMonthISO, todayISO } from "@/lib/date";

export interface DashboardEmployee {
  id: string;
  full_name: string;
  role: "employee" | "team_lead" | "hr" | "admin";
  slack_user_id: string | null;
  team_id: string | null;
  join_date: string;
  team: { id: string; name: string; lead_id: string | null } | null;
}

export interface DashboardData {
  employee: DashboardEmployee;
  todayISO: string;
  /** First day of the calendar month the page is showing (YYYY-MM-01). */
  monthStartISO: string;
  /** Last day of the calendar month the page is showing. */
  monthEndISO: string;
  /** Logs for the selected month only. */
  monthLogs: AttendanceLog[];
  /** Holidays falling inside the selected month. */
  holidays: Holiday[];
  balance: BalanceRow | null;
  lifetimeCount: number;
  /** Today's row (always — survives even when the calendar shows a past
   *  month, so the Today banner keeps reflecting the real today). */
  todayLog: AttendanceLog | null;
  wfhThisMonth: number;
  todayHoliday: string | null;
  isFirstTime: boolean;
}

/**
 * Fetch everything the calendar dashboard needs for a given employee.
 *
 * Used by:
 *  - `/`                      → loads for the signed-in user
 *  - `/admin/employees/[id]`  → HR/admin loads for another employee
 *
 * Optional `monthISO` (any day in the target month, e.g. "2026-05-01")
 * controls which month's logs + holidays are fetched. The Today banner
 * + balance card always read live today/this-month, regardless of which
 * month the calendar is paged to.
 *
 * Uses the admin client so HR can read other employees' rows without
 * tripping RLS. The route is responsible for role-gating before calling.
 *
 * Returns null when the employees row doesn't exist for the given id.
 */
export async function loadDashboardData(
  employeeId: string,
  opts?: { monthISO?: string },
): Promise<DashboardData | null> {
  const admin = createAdminClient();
  const today = todayISO();
  const monthSeed = opts?.monthISO ?? today;
  const monthStart = firstOfMonthISO(monthSeed);
  const monthEnd = lastOfMonthISO(monthSeed);

  const { data: employee } = await admin
    .from("employees")
    .select(
      `id, full_name, role, slack_user_id, team_id, join_date,
       team:teams!team_id ( id, name, lead_id )`,
    )
    .eq("id", employeeId)
    .maybeSingle<DashboardEmployee>();

  if (!employee) return null;

  // wfh-this-month always refers to today's month, not the paged month.
  const thisMonthStart = firstOfMonthISO(today);
  const thisMonthEnd = lastOfMonthISO(today);

  const [logsRes, holidaysRes, balanceRes, totalRes, todayLogRes, thisMonthLogsRes] =
    await Promise.all([
      admin
        .from("attendance_logs")
        .select(
          "id, employee_id, date, type, half, reason, status, source, slack_message_ts, created_by, created_at, updated_at, checkin_time, checkout_time, total_hours",
        )
        .eq("employee_id", employee.id)
        .gte("date", monthStart)
        .lte("date", monthEnd)
        .order("date", { ascending: true }),
      admin
        .from("holidays")
        .select("id, date, name, is_optional")
        .gte("date", monthStart)
        .lte("date", monthEnd),
      admin
        .from("v_employee_balances")
        .select(
          "employee_id, full_name, casual_allowance, casual_used, sick_allowance, sick_used, annual_allowance, annual_used",
        )
        .eq("employee_id", employee.id)
        .maybeSingle<BalanceRow>(),
      admin
        .from("attendance_logs")
        .select("*", { count: "exact", head: true })
        .eq("employee_id", employee.id),
      admin
        .from("attendance_logs")
        .select(
          "id, employee_id, date, type, half, reason, status, source, slack_message_ts, created_by, created_at, updated_at, checkin_time, checkout_time, total_hours",
        )
        .eq("employee_id", employee.id)
        .eq("date", today)
        .maybeSingle<AttendanceLog>(),
      // For wfh-this-month: only run a second query when the paged month
      // is *not* today's month. When it is, we reuse logsRes below.
      monthStart === thisMonthStart
        ? Promise.resolve({ data: null })
        : admin
            .from("attendance_logs")
            .select("type, date")
            .eq("employee_id", employee.id)
            .gte("date", thisMonthStart)
            .lte("date", thisMonthEnd),
    ]);

  const monthLogs = (logsRes.data ?? []) as AttendanceLog[];
  const holidays = (holidaysRes.data ?? []) as Holiday[];
  const balance = (balanceRes.data ?? null) as BalanceRow | null;
  const lifetimeCount = totalRes.count ?? 0;
  const todayLog = (todayLogRes.data ?? null) as AttendanceLog | null;

  const wfhSource =
    thisMonthLogsRes.data == null
      ? monthLogs
      : (thisMonthLogsRes.data as { type: string }[]);
  const wfhThisMonth = wfhSource.filter(
    (l) => l.type === "wfh" || l.type === "ewd",
  ).length;
  const todayHoliday =
    holidays.find((h) => h.date === today)?.name ?? null;

  return {
    employee,
    todayISO: today,
    monthStartISO: monthStart,
    monthEndISO: monthEnd,
    monthLogs,
    holidays,
    balance,
    lifetimeCount,
    todayLog,
    wfhThisMonth,
    todayHoliday,
    isFirstTime: lifetimeCount === 0,
  };
}
