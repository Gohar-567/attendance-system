import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Buckets the v_today_status rows into the 5 numbers shown in the
 * dashboard's top strip. v_today_status returns one row per active
 * employee with `status` = the attendance type for today, or 'unmarked'.
 *
 * Optional team filter narrows to a single team_id.
 */
export interface TodayCounts {
  total: number;
  present: number;
  wfh: number;
  half: number;
  on_leave: number;
  unmarked: number;
}

export interface TodayEmployeeRow {
  employee_id: string;
  full_name: string;
  team_id: string | null;
  team_name: string | null;
  status: string; // attendance_type or 'unmarked'
  half: string | null;
  reason: string | null;
}

/**
 * Pull every active employee with today's attendance + team. Two parallel
 * queries (employees + today's logs) merged in memory — the dataset is
 * 30 rows, no need for SQL acrobatics.
 */
export async function fetchTodaySnapshot(opts?: {
  teamId?: string | null;
}): Promise<TodayEmployeeRow[]> {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const empQ = admin
    .from("employees")
    .select(`id, full_name, team_id, team:teams!team_id ( id, name )`)
    .eq("is_active", true)
    .order("full_name");
  if (opts?.teamId) empQ.eq("team_id", opts.teamId);

  const [empRes, logRes] = await Promise.all([
    empQ,
    admin
      .from("attendance_logs")
      .select("employee_id, type, half, reason")
      .eq("date", today),
  ]);

  type EmpRow = {
    id: string;
    full_name: string;
    team_id: string | null;
    team: { id: string; name: string } | null;
  };
  type LogRow = {
    employee_id: string;
    type: string;
    half: string | null;
    reason: string | null;
  };

  const employees = (empRes.data ?? []) as unknown as EmpRow[];
  const logs = (logRes.data ?? []) as LogRow[];
  const byEmp = new Map<string, LogRow>();
  for (const l of logs) byEmp.set(l.employee_id, l);

  return employees.map((e) => {
    const l = byEmp.get(e.id);
    return {
      employee_id: e.id,
      full_name: e.full_name,
      team_id: e.team_id,
      team_name: e.team?.name ?? null,
      status: l?.type ?? "unmarked",
      half: l?.half ?? null,
      reason: l?.reason ?? null,
    };
  });
}

export function bucketCounts(rows: TodayEmployeeRow[]): TodayCounts {
  const c: TodayCounts = {
    total: rows.length,
    present: 0,
    wfh: 0,
    half: 0,
    on_leave: 0,
    unmarked: 0,
  };
  for (const r of rows) {
    switch (r.status) {
      case "present":
        c.present++;
        break;
      case "wfh":
      case "ewd":
        c.wfh++;
        break;
      case "half_leave":
        c.half++;
        break;
      case "full_leave":
      case "sick":
        c.on_leave++;
        break;
      case "holiday":
        // Treat as off — surface as unmarked count would be misleading.
        // For simplicity, count under on_leave so the strip doesn't lie.
        c.on_leave++;
        break;
      default:
        c.unmarked++;
    }
  }
  return c;
}
