import { createAdminClient } from "@/lib/supabase/admin";

import { firstOfMonthISO, lastOfMonthISO } from "@/lib/date";
import { fetchHolidaySet } from "@/lib/leave/holidays";
import { countWorkingDays } from "@/lib/leave/working-days";

export interface MonthlyReportRow {
  employee_id: string;
  full_name: string;
  team_id: string | null;
  team_name: string | null;
  present: number;
  wfh: number;
  half: number;
  casual: number;
  sick: number;
  annual: number;
  /** Phase 7C — sum of total_hours for this employee this month. */
  total_hours: number;
  /** Days the user actually has hours data for (denominator for avg). */
  hours_days: number;
  /** total_hours / hours_days; null when no hours yet. */
  avg_hours_per_day: number | null;
  /** Phase 9 — total work sessions this month. */
  total_sessions: number;
  /** Phase 9 — avg sessions per day worked; null when no sessions. */
  sessions_per_day: number | null;
}

export interface MonthlyKpis {
  /** Avg attendance rate = (present + wfh + half/2) / (working_days × employees) */
  avg_attendance_rate: number;
  /** WFH ratio = wfh / (wfh + present + half) */
  wfh_ratio: number;
  /** Total leave-days taken across all employees this month. */
  total_leaves: number;
  /** Working days in the month — handy for headers. */
  working_days: number;
}

/**
 * Build the per-employee monthly summary used by the Monthly Report screen
 * and the Excel export. Casual vs Annual is disambiguated by the reason
 * prefix that expand.ts writes ("Casual leave" / "Annual leave …") — this
 * is an internal contract; if expand.ts changes, this query needs to too.
 */
export async function fetchMonthlySummary(opts: {
  monthISO: string; // any date in the month, e.g. "2026-05-01"
  teamId?: string | null;
}): Promise<{ rows: MonthlyReportRow[]; kpis: MonthlyKpis }> {
  const admin = createAdminClient();
  const fromISO = firstOfMonthISO(opts.monthISO);
  const toISO = lastOfMonthISO(opts.monthISO);

  const empQ = admin
    .from("employees")
    .select(`id, full_name, team_id, team:teams!team_id ( id, name )`)
    .eq("is_active", true)
    .order("full_name");
  if (opts.teamId) empQ.eq("team_id", opts.teamId);

  const [empRes, logRes, sessionRes, holidaySet] = await Promise.all([
    empQ,
    admin
      .from("attendance_logs")
      .select("employee_id, date, type, reason, total_hours")
      .gte("date", fromISO)
      .lte("date", toISO),
    admin
      .from("work_sessions")
      .select("employee_id, session_date")
      .gte("session_date", fromISO)
      .lte("session_date", toISO),
    fetchHolidaySet(admin, fromISO, toISO),
  ]);

  type EmpRow = {
    id: string;
    full_name: string;
    team_id: string | null;
    team: { id: string; name: string } | null;
  };
  type LogRow = {
    employee_id: string;
    date: string;
    type: string;
    reason: string | null;
    total_hours: number | null;
  };

  const employees = (empRes.data ?? []) as unknown as EmpRow[];
  const logs = (logRes.data ?? []) as LogRow[];
  const sessionRows = (sessionRes.data ?? []) as {
    employee_id: string;
    session_date: string;
  }[];

  const empSet = new Set(employees.map((e) => e.id));
  const stats = new Map<string, MonthlyReportRow>();
  for (const e of employees) {
    stats.set(e.id, {
      employee_id: e.id,
      full_name: e.full_name,
      team_id: e.team_id,
      team_name: e.team?.name ?? null,
      present: 0,
      wfh: 0,
      half: 0,
      casual: 0,
      sick: 0,
      annual: 0,
      total_hours: 0,
      hours_days: 0,
      avg_hours_per_day: null,
      total_sessions: 0,
      sessions_per_day: null,
    });
  }

  // Sessions per employee: total count + distinct session days.
  const sessionDays = new Map<string, Set<string>>();
  for (const s of sessionRows) {
    if (!empSet.has(s.employee_id)) continue;
    const row = stats.get(s.employee_id)!;
    row.total_sessions++;
    if (!sessionDays.has(s.employee_id)) {
      sessionDays.set(s.employee_id, new Set());
    }
    sessionDays.get(s.employee_id)!.add(s.session_date);
  }

  for (const l of logs) {
    if (!empSet.has(l.employee_id)) continue;
    const row = stats.get(l.employee_id)!;
    switch (l.type) {
      case "present":
        row.present++;
        break;
      case "wfh":
      case "ewd":
        row.wfh++;
        break;
      case "half_leave":
        row.half++;
        break;
      case "sick":
        row.sick++;
        break;
      case "full_leave": {
        const r = (l.reason ?? "").toLowerCase();
        if (r.startsWith("annual leave")) row.annual++;
        else row.casual++;
        break;
      }
      default:
        break;
    }
    if (l.total_hours != null) {
      row.total_hours += Number(l.total_hours);
      row.hours_days++;
    }
  }

  const rows = [...stats.values()].map((r) => {
    const days = sessionDays.get(r.employee_id)?.size ?? 0;
    return {
      ...r,
      avg_hours_per_day: r.hours_days > 0 ? r.total_hours / r.hours_days : null,
      sessions_per_day: days > 0 ? r.total_sessions / days : null,
    };
  });

  const workingDays = countWorkingDays(fromISO, toISO, holidaySet);

  let totalCovered = 0;
  let totalWfh = 0;
  let totalLeaves = 0;
  for (const r of rows) {
    totalCovered += r.present + r.wfh + r.half * 0.5;
    totalWfh += r.wfh;
    totalLeaves += r.casual + r.sick + r.annual + r.half * 0.5;
  }

  const employeeCount = rows.length;
  const denominator = workingDays * Math.max(1, employeeCount);
  const wfhDenominator = rows.reduce(
    (acc, r) => acc + r.present + r.wfh + r.half,
    0,
  );

  const kpis: MonthlyKpis = {
    avg_attendance_rate: denominator > 0 ? totalCovered / denominator : 0,
    wfh_ratio: wfhDenominator > 0 ? totalWfh / wfhDenominator : 0,
    total_leaves: Number(totalLeaves.toFixed(1)),
    working_days: workingDays,
  };

  return { rows, kpis };
}
