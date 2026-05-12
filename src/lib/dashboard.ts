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
  monthStartISO: string;
  monthEndISO: string;
  monthLogs: AttendanceLog[];
  holidays: Holiday[];
  balance: BalanceRow | null;
  lifetimeCount: number;
  todayLog: AttendanceLog | null;
  wfhThisMonth: number;
  todayHoliday: string | null;
  isFirstTime: boolean;
}

/**
 * Fetch everything the calendar dashboard needs for a given employee.
 *
 * Used by:
 *  - `/`               → loads for the signed-in user
 *  - `/admin/employees/[id]` → HR/admin loads for another employee
 *
 * Uses the admin client so HR can read other employees' rows without
 * tripping RLS. The route is responsible for role-gating before calling.
 *
 * Returns null when the employees row doesn't exist for the given id.
 */
export async function loadDashboardData(
  employeeId: string,
): Promise<DashboardData | null> {
  const admin = createAdminClient();
  const today = todayISO();
  const monthStart = firstOfMonthISO(today);
  const monthEnd = lastOfMonthISO(today);

  const { data: employee } = await admin
    .from("employees")
    .select(
      `id, full_name, role, slack_user_id, team_id, join_date,
       team:teams!team_id ( id, name, lead_id )`,
    )
    .eq("id", employeeId)
    .maybeSingle<DashboardEmployee>();

  if (!employee) return null;

  const [logsRes, holidaysRes, balanceRes, totalRes, todayLogRes] =
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
    ]);

  const monthLogs = (logsRes.data ?? []) as AttendanceLog[];
  const holidays = (holidaysRes.data ?? []) as Holiday[];
  const balance = (balanceRes.data ?? null) as BalanceRow | null;
  const lifetimeCount = totalRes.count ?? 0;
  const todayLog = (todayLogRes.data ?? null) as AttendanceLog | null;

  const wfhThisMonth = monthLogs.filter(
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
