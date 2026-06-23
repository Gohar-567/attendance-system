import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate, durationHours, MAX_SESSION_HOURS } from "@/lib/business-day";
import type { AttendanceHalf, AttendanceType } from "@/lib/attendance";

/** Minimal shape of an open session we care about. */
export interface OpenSession {
  id: string;
  started_at: string;
  attendance_log_id: string | null;
  session_date: string;
}

/**
 * The single open (no-checkout) session for an employee, if any. Phase 9
 * allows only one open session at a time, so we return the most recent.
 */
export async function findOpenSession(
  admin: SupabaseClient,
  employeeId: string,
): Promise<OpenSession | null> {
  const { data } = await admin
    .from("work_sessions")
    .select("id, started_at, attendance_log_id, session_date")
    .eq("employee_id", employeeId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<OpenSession>();
  return data ?? null;
}

export interface OpenSessionResolution {
  /** A still-open session from the SAME business day as now → block the
   *  new check-in (they're trying to check in twice without closing). */
  blocked: OpenSession | null;
  /** Open sessions from PRIOR business days, auto-tagged source='unclosed'
   *  so the new check-in can proceed. */
  tagged: OpenSession[];
}

/**
 * Decide what to do with an employee's open sessions when they check in.
 *
 * Phase 9.1: the block threshold is "an open session from the same business
 * day as now" (not "any open session < 7 days" — that trapped people behind
 * legacy pre-Phase-9 opens). Prior-day opens are tagged incomplete on the
 * fly and don't block.
 *
 * `nowBusinessDate` should be businessDate(now()). Tagging happens here as a
 * side effect; the caller is responsible for the DM / proceed.
 */
export async function resolveOpenSessionsForCheckin(
  admin: SupabaseClient,
  employeeId: string,
  nowBusinessDate: string,
): Promise<OpenSessionResolution> {
  const { data } = await admin
    .from("work_sessions")
    .select("id, started_at, attendance_log_id, session_date")
    .eq("employee_id", employeeId)
    .is("ended_at", null)
    .order("started_at", { ascending: true });
  const open = (data ?? []) as OpenSession[];

  const blocked = open.find((s) => s.session_date === nowBusinessDate) ?? null;
  if (blocked) {
    // Same-day open session wins — block, leave everything as-is.
    return { blocked, tagged: [] };
  }

  const tagged = open.filter((s) => s.session_date !== nowBusinessDate);
  if (tagged.length > 0) {
    await admin
      .from("work_sessions")
      .update({ source: "unclosed" })
      .in(
        "id",
        tagged.map((s) => s.id),
      );
  }
  return { blocked: null, tagged };
}

/**
 * Find or create the attendance_logs row for (employee, businessDate).
 * Preserves an existing non-leave type unless `forceType` is given.
 * Returns the row id, or null on failure.
 */
export async function findOrCreateLog(
  admin: SupabaseClient,
  opts: {
    employeeId: string;
    date: string;
    type: AttendanceType;
    half?: AttendanceHalf;
    source?: string;
    createdBy?: string | null;
    forceType?: boolean;
  },
): Promise<{ id: string; type: string } | null> {
  const { data: existing } = await admin
    .from("attendance_logs")
    .select("id, type")
    .eq("employee_id", opts.employeeId)
    .eq("date", opts.date)
    .maybeSingle<{ id: string; type: string }>();

  if (existing) {
    // Only upgrade an unmarked/leave row to the working type when asked.
    if (opts.forceType && existing.type !== opts.type) {
      await admin
        .from("attendance_logs")
        .update({ type: opts.type, half: opts.half ?? "full" })
        .eq("id", existing.id);
      return { id: existing.id, type: opts.type };
    }
    return existing;
  }

  const { data: inserted, error } = await admin
    .from("attendance_logs")
    .insert({
      employee_id: opts.employeeId,
      date: opts.date,
      type: opts.type,
      half: opts.half ?? "full",
      status: "confirmed",
      source: opts.source ?? "web",
      created_by: opts.createdBy ?? opts.employeeId,
    })
    .select("id, type")
    .single();

  if (error || !inserted) return null;
  return inserted;
}

/**
 * Open a new session for an employee (check-in). Caller is responsible for
 * the open-session block (see findOpenSession). Anchors the parent log to
 * businessDate(startedAt). Returns the new session id or null.
 */
export async function openSession(opts: {
  employeeId: string;
  startedAt: string;
  type?: AttendanceType;
  half?: AttendanceHalf;
  source?: string;
  createdBy?: string | null;
}): Promise<{ sessionId: string; attendanceLogId: string } | null> {
  const admin = createAdminClient();
  const date = businessDate(opts.startedAt);
  const log = await findOrCreateLog(admin, {
    employeeId: opts.employeeId,
    date,
    type: opts.type ?? "present",
    half: opts.half,
    source: opts.source,
    createdBy: opts.createdBy,
    forceType: opts.type != null,
  });
  if (!log) return null;

  const { data, error } = await admin
    .from("work_sessions")
    .insert({
      employee_id: opts.employeeId,
      attendance_log_id: log.id,
      started_at: opts.startedAt,
      source: opts.source ?? "web",
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { sessionId: data.id as string, attendanceLogId: log.id };
}

export type CloseSessionResult =
  | { ok: true; durationHours: number }
  | { ok: false; reason: "too_long" | "not_after_start" | "error" };

/**
 * Close an open session at `endedAt`. Rejects if the resulting span would
 * exceed MAX_SESSION_HOURS (16h) or isn't strictly after the start.
 */
export async function closeSession(
  sessionId: string,
  startedAt: string,
  endedAt: string,
): Promise<CloseSessionResult> {
  if (new Date(endedAt).getTime() <= new Date(startedAt).getTime()) {
    return { ok: false, reason: "not_after_start" };
  }
  const dur = durationHours(startedAt, endedAt);
  if (dur > MAX_SESSION_HOURS) {
    return { ok: false, reason: "too_long" };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("work_sessions")
    .update({ ended_at: endedAt })
    .eq("id", sessionId);
  if (error) return { ok: false, reason: "error" };
  return { ok: true, durationHours: dur };
}
