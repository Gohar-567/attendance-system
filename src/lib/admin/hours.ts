import { createAdminClient } from "@/lib/supabase/admin";

import { dowOf, firstOfMonthISO, lastOfMonthISO, todayISO } from "@/lib/date";

export interface HoursRow {
  employee_id: string;
  full_name: string;
  team_id: string | null;
  team_name: string | null;
  hours_today: number | null;
  hours_week: number;
  hours_month: number;
  /** Sum of total_hours / days-with-data this month. null when zero days. */
  avg_hours_per_day: number | null;
  days_worked_month: number;
  /** Phase 9 — number of work sessions this month (flags fragmented days). */
  sessions_month: number;
  /** Total hours in the user-selected range (drives the Excel export). */
  hours_in_range: number;
  days_in_range: number;
}

function mondayOfWeek(today: string): string {
  const dow = dowOf(today);
  const daysBack = dow === 0 ? 6 : dow - 1;
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - daysBack)).toISOString().slice(0, 10);
}

export interface FetchHoursOpts {
  /** Optional team filter. */
  teamId?: string | null;
  /** Date range for the "in_range" totals + the Excel export. */
  fromISO: string;
  toISO: string;
}

export async function fetchHoursOverview(
  opts: FetchHoursOpts,
): Promise<{ rows: HoursRow[]; today: string; weekStart: string }> {
  const admin = createAdminClient();
  const today = todayISO();
  const weekStart = mondayOfWeek(today);
  const monthStart = firstOfMonthISO(today);
  const monthEnd = lastOfMonthISO(today);
  // Pull a wide window once: month start OR range start, whichever is earlier.
  // toISO defaults to today; never goes past month end on screen.
  const widestStart = opts.fromISO < monthStart ? opts.fromISO : monthStart;
  const widestEnd = opts.toISO > monthEnd ? opts.toISO : monthEnd;

  const empQ = admin
    .from("employees")
    .select(`id, full_name, team_id, team:teams!team_id ( id, name )`)
    .eq("is_active", true)
    .order("full_name");
  if (opts.teamId) empQ.eq("team_id", opts.teamId);

  const [empRes, logsRes, sessionsRes] = await Promise.all([
    empQ,
    admin
      .from("attendance_logs")
      .select("employee_id, date, total_hours")
      .gte("date", widestStart)
      .lte("date", widestEnd)
      .not("total_hours", "is", null),
    admin
      .from("work_sessions")
      .select("employee_id, session_date")
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd),
  ]);

  type Emp = {
    id: string;
    full_name: string;
    team_id: string | null;
    team: { id: string; name: string } | null;
  };
  type Log = { employee_id: string; date: string; total_hours: number };

  const employees = (empRes.data ?? []) as unknown as Emp[];
  const logs = (logsRes.data ?? []) as Log[];
  const sessions = (sessionsRes.data ?? []) as {
    employee_id: string;
    session_date: string;
  }[];

  const empIds = new Set(employees.map((e) => e.id));
  const byEmp = new Map<string, Log[]>();
  for (const l of logs) {
    if (!empIds.has(l.employee_id)) continue;
    if (!byEmp.has(l.employee_id)) byEmp.set(l.employee_id, []);
    byEmp.get(l.employee_id)!.push(l);
  }
  const sessionCount = new Map<string, number>();
  for (const s of sessions) {
    if (!empIds.has(s.employee_id)) continue;
    sessionCount.set(s.employee_id, (sessionCount.get(s.employee_id) ?? 0) + 1);
  }

  const rows: HoursRow[] = employees.map((e) => {
    const my = byEmp.get(e.id) ?? [];
    let hoursMonth = 0;
    let daysMonth = 0;
    let hoursWeek = 0;
    let hoursToday: number | null = null;
    let hoursInRange = 0;
    let daysInRange = 0;
    for (const l of my) {
      const v = Number(l.total_hours);
      if (l.date >= monthStart && l.date <= monthEnd) {
        hoursMonth += v;
        daysMonth++;
      }
      if (l.date >= weekStart && l.date <= today) {
        hoursWeek += v;
      }
      if (l.date === today) {
        hoursToday = (hoursToday ?? 0) + v;
      }
      if (l.date >= opts.fromISO && l.date <= opts.toISO) {
        hoursInRange += v;
        daysInRange++;
      }
    }
    return {
      employee_id: e.id,
      full_name: e.full_name,
      team_id: e.team_id,
      team_name: e.team?.name ?? null,
      hours_today: hoursToday,
      hours_week: hoursWeek,
      hours_month: hoursMonth,
      avg_hours_per_day: daysMonth > 0 ? hoursMonth / daysMonth : null,
      days_worked_month: daysMonth,
      sessions_month: sessionCount.get(e.id) ?? 0,
      hours_in_range: hoursInRange,
      days_in_range: daysInRange,
    };
  });

  return { rows, today, weekStart };
}

// ---- Date-range parsing for the page + the export endpoint ---------

export type RangeKind = "last7" | "last30" | "custom";

export function resolveRange(params: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): { kind: RangeKind; fromISO: string; toISO: string } {
  const today = todayISO();
  if (params.range === "custom" && params.from && params.to) {
    return { kind: "custom", fromISO: params.from, toISO: params.to };
  }
  if (params.range === "last30") {
    return { kind: "last30", fromISO: addDays(today, -29), toISO: today };
  }
  // default + last7
  return { kind: "last7", fromISO: addDays(today, -6), toISO: today };
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
