"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EDITABLE_TYPES,
  isSessionType,
  type EditableType,
} from "@/lib/attendance";
import {
  businessDate,
  durationHours,
  todayBusinessDate,
  MAX_SESSION_HOURS,
} from "@/lib/business-day";
import type { ActionResult, SaveDayInput, DaySessionInput } from "./types";

async function getActor(): Promise<
  { ok: false; error: string } | { ok: true; userId: string; role: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const admin = createAdminClient();
  const { data: actor } = await admin
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (!actor) return { ok: false, error: "Employee record missing" };
  return { ok: true, userId: user.id, role: actor.role };
}

function isHr(role: string): boolean {
  return role === "hr" || role === "admin";
}

/** Validate one session edit. Returns an error message or null. */
function validateSession(s: DaySessionInput, date: string): string | null {
  if (!s.startedAt) return "A session is missing its start time";
  const startMs = new Date(s.startedAt).getTime();
  if (Number.isNaN(startMs)) return "A session has an invalid start time";
  if (businessDate(s.startedAt) !== date) {
    return "A session's start time falls on a different business day (the day runs 9 AM → next 9 AM)";
  }
  if (s.endedAt != null) {
    const endMs = new Date(s.endedAt).getTime();
    if (Number.isNaN(endMs)) return "A session has an invalid end time";
    if (endMs <= startMs) return "Each session's end must be after its start";
    if (durationHours(s.startedAt, s.endedAt) > MAX_SESSION_HOURS) {
      return `A session is over ${MAX_SESSION_HOURS} hours — check the times`;
    }
  }
  return null;
}

/**
 * Save a whole business day: type/half/reason + the complete desired set of
 * work sessions, reconciled (insert / update / delete) against storage.
 * Hours are recomputed by DB triggers. Used by the Day Detail modal for
 * both today and backdated days; weekends/holidays are allowed (Phase 9).
 */
export async function saveDayAction(input: SaveDayInput): Promise<ActionResult> {
  const auth = await getActor();
  if (!auth.ok) return auth;

  const employeeId = input.employeeId ?? auth.userId;
  if (employeeId !== auth.userId && !isHr(auth.role)) {
    return { ok: false, error: "Not authorized" };
  }

  if (input.date > todayBusinessDate()) {
    return { ok: false, error: "That day hasn't happened yet" };
  }
  if (!EDITABLE_TYPES.includes(input.type as EditableType)) {
    return { ok: false, error: "Invalid type" };
  }
  if (input.type !== "half_leave" && input.half !== "full") {
    return { ok: false, error: "Half only applies to half-leave entries" };
  }

  const sessionType = isSessionType(input.type);
  const sessions = sessionType ? input.sessions : [];

  for (const s of sessions) {
    const err = validateSession(s, input.date);
    if (err) return { ok: false, error: err };
  }

  const admin = createAdminClient();

  // Locate / lock-check the day's row.
  const { data: existingLog } = await admin
    .from("attendance_logs")
    .select("id, employee_id, type, half, reason, source, status")
    .eq("employee_id", employeeId)
    .eq("date", input.date)
    .maybeSingle<{
      id: string;
      employee_id: string;
      type: string;
      half: string;
      reason: string | null;
      source: string;
      status: string;
    }>();

  const locked =
    existingLog?.source === "leave_request" && existingLog?.status === "approved";
  if (locked && !isHr(auth.role)) {
    return {
      ok: false,
      error: "Approved leave entries can only be changed by HR",
    };
  }

  const reason = input.reason?.trim() || null;
  let logId: string;

  if (existingLog) {
    const { error } = await admin
      .from("attendance_logs")
      .update({
        type: input.type,
        half: input.half,
        reason,
        status: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingLog.id);
    if (error) return { ok: false, error: error.message };
    logId = existingLog.id;
  } else {
    const backdated = input.date < todayBusinessDate();
    const { data: inserted, error } = await admin
      .from("attendance_logs")
      .insert({
        employee_id: employeeId,
        date: input.date,
        type: input.type,
        half: input.half,
        reason,
        status: "confirmed",
        source: backdated ? "web_backdated" : "web",
        created_by: auth.userId,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      return { ok: false, error: error?.message ?? "Couldn't create the day" };
    }
    logId = inserted.id;
  }

  // Reconcile sessions against what's stored for this log.
  const { data: stored } = await admin
    .from("work_sessions")
    .select("id")
    .eq("attendance_log_id", logId);
  const storedIds = new Set((stored ?? []).map((r) => r.id as string));
  const keepIds = new Set(
    sessions.filter((s) => s.id).map((s) => s.id as string),
  );

  // Deletes: stored sessions not present in the desired set (covers the
  // non-session-type case too, where `sessions` is empty → clear all).
  const toDelete = [...storedIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await admin
      .from("work_sessions")
      .delete()
      .in("id", toDelete);
    if (error) return { ok: false, error: error.message };
  }

  const source = input.date < todayBusinessDate() ? "web_backdated" : "web";
  for (const s of sessions) {
    if (s.id && storedIds.has(s.id)) {
      const { error } = await admin
        .from("work_sessions")
        .update({ started_at: s.startedAt, ended_at: s.endedAt })
        .eq("id", s.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await admin.from("work_sessions").insert({
        employee_id: employeeId,
        attendance_log_id: logId,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        source,
      });
      if (error) return { ok: false, error: error.message };
    }
  }

  const hrOnOthers = isHr(auth.role) && employeeId !== auth.userId;
  await admin.from("audit_log").insert({
    actor_id: auth.userId,
    action: existingLog ? "attendance_edited" : "attendance_added_backdated",
    target_type: "attendance_log",
    target_id: logId,
    details: {
      date: input.date,
      type: input.type,
      half: input.half,
      reason,
      session_count: sessions.length,
      ...(hrOnOthers ? { target_employee_id: employeeId } : null),
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath(`/admin/employees/${employeeId}`);
  return { ok: true };
}
