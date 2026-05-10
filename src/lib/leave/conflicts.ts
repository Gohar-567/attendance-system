import type { SupabaseClient } from "@supabase/supabase-js";

export interface TeamConflict {
  employee_id: string;
  full_name: string;
  dates: string[];
}

/**
 * Find teammates whose approved attendance_logs of type
 * full_leave / sick / annual_leave overlap with [fromISO, toISO].
 *
 * Returns one entry per overlapping employee with the colliding dates.
 * The form on /leave/new uses this for the soft conflict warning.
 *
 * Caller passes the requesting employee's team_id; we exclude the
 * requester themselves and only consider active teammates.
 */
export async function findTeamConflicts(
  supabase: SupabaseClient,
  opts: {
    teamId: string | null;
    excludeEmployeeId: string;
    fromISO: string;
    toISO: string;
  },
): Promise<TeamConflict[]> {
  const { teamId, excludeEmployeeId, fromISO, toISO } = opts;
  if (!teamId) return [];

  // Pull team members (id + name) and their overlapping logs in two queries
  // rather than one big join — RLS handles row visibility.
  const { data: teammates } = await supabase
    .from("employees")
    .select("id, full_name")
    .eq("team_id", teamId)
    .eq("is_active", true)
    .neq("id", excludeEmployeeId);

  const ids = (teammates ?? []).map((t) => t.id);
  if (ids.length === 0) return [];

  const { data: logs } = await supabase
    .from("attendance_logs")
    .select("employee_id, date, type")
    .in("employee_id", ids)
    .in("type", ["full_leave", "sick"])
    .gte("date", fromISO)
    .lte("date", toISO);

  const byEmployee = new Map<string, string[]>();
  for (const l of logs ?? []) {
    const cur = byEmployee.get(l.employee_id) ?? [];
    cur.push(l.date);
    byEmployee.set(l.employee_id, cur);
  }

  const out: TeamConflict[] = [];
  for (const t of teammates ?? []) {
    const dates = byEmployee.get(t.id);
    if (dates && dates.length > 0) {
      out.push({
        employee_id: t.id,
        full_name: t.full_name,
        dates: dates.sort(),
      });
    }
  }
  return out;
}
