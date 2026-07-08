"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO } from "@/lib/date";
import { todayBusinessDate } from "@/lib/business-day";
import {
  findOpenSession,
  resolveOpenSessionsForCheckin,
  openSession,
  closeSession,
} from "@/lib/sessions";
import { formatInstantTime } from "@/lib/time";
import { clearAttendanceLeaveForDay } from "@/lib/leave/attendance-sync";
import type { ActionResult } from "./types";

/**
 * Mark today as WFH (full day) for the current user. Idempotent: upserts
 * on (employee_id, date). Used from the Dashboard's "Log WFH" button.
 */
export async function logWfhTodayAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const date = todayISO();

  const { error } = await supabase.from("attendance_logs").upsert(
    {
      employee_id: user.id,
      date,
      type: "wfh",
      half: "full",
      status: "auto_logged",
      source: "web",
      created_by: user.id,
    },
    { onConflict: "employee_id,date" },
  );

  if (error) return { ok: false, error: error.message };

  // If this day previously held a Sick/Half entry, its auto-synced
  // leave_request must go — WFH consumes no balance. Best-effort: the WFH
  // upsert already succeeded, so don't fail the action on a sync error.
  try {
    await clearAttendanceLeaveForDay(createAdminClient(), user.id, date);
  } catch (err) {
    console.error("clearAttendanceLeaveForDay failed on WFH log", err);
  }

  revalidatePath("/");
  revalidatePath("/history");
  return { ok: true };
}

/** Shared authentication + role lookup for the delete path. */
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

/** Delete an attendance_logs row (and its sessions, via cascade). HR only. */
export async function deleteAttendanceAction(
  logId: string,
): Promise<ActionResult> {
  const auth = await getActor();
  if (!auth.ok) return auth;
  if (!isHr(auth.role)) {
    return { ok: false, error: "Only HR can delete entries" };
  }

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("attendance_logs")
    .select("id, employee_id, date, type, half, reason, status, source")
    .eq("id", logId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Entry not found" };

  const { error } = await admin
    .from("attendance_logs")
    .delete()
    .eq("id", logId);
  if (error) return { ok: false, error: error.message };

  // Drop any leave_request this day auto-created (Sick / Half), so the
  // balance card releases the day back. Best-effort: the attendance row is
  // already deleted, so a sync failure must not fail the action.
  try {
    await clearAttendanceLeaveForDay(admin, before.employee_id, before.date);
  } catch (err) {
    console.error("clearAttendanceLeaveForDay failed on delete", err);
  }

  await admin.from("audit_log").insert({
    actor_id: auth.userId,
    action: "attendance_deleted",
    target_type: "attendance_log",
    target_id: logId,
    details: {
      before,
      ...(before.employee_id !== auth.userId
        ? { actor_id: auth.userId, target_employee_id: before.employee_id }
        : null),
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath(`/admin/employees/${before.employee_id}`);
  return { ok: true };
}

/**
 * "Check in now" button on the Today banner — opens a work session at the
 * current instant. Phase 9: blocks if a prior session is still open (so
 * people close yesterday's first), unless that open session is stale
 * (> 7 days), in which case it's tagged 'unclosed' for HR and we proceed.
 */
export async function checkInNowAction(): Promise<ActionResult> {
  const auth = await getActor();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  // Block only on a same-business-day open session; prior-day opens are
  // auto-tagged 'unclosed' and don't trap the user (Phase 9.1).
  const resolution = await resolveOpenSessionsForCheckin(
    admin,
    auth.userId,
    todayBusinessDate(),
  );
  if (resolution.blocked) {
    return {
      ok: false,
      error: `You already have an open session from today (started ${formatInstantTime(resolution.blocked.started_at)}). Check out before starting a new session.`,
    };
  }

  const result = await openSession({
    employeeId: auth.userId,
    startedAt: new Date().toISOString(),
    source: "web",
    createdBy: auth.userId,
  });
  if (!result) return { ok: false, error: "Couldn't start a session" };

  revalidatePath("/");
  revalidatePath("/history");
  return { ok: true };
}

/**
 * "Check out" button on the Today banner — closes the current open session
 * at now. Rejects sessions that would exceed 16 hours (Decision 2).
 */
export async function checkOutNowAction(): Promise<ActionResult> {
  const auth = await getActor();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const open = await findOpenSession(admin, auth.userId);
  if (!open) {
    return { ok: false, error: "You don't have an open session to check out of" };
  }

  const result = await closeSession(
    open.id,
    open.started_at,
    new Date().toISOString(),
  );
  if (!result.ok) {
    if (result.reason === "too_long") {
      return {
        ok: false,
        error:
          "This session is over 16 hours. Please check your check-in time or contact HR.",
      };
    }
    return { ok: false, error: "Couldn't check out" };
  }

  revalidatePath("/");
  revalidatePath("/history");
  return { ok: true };
}
