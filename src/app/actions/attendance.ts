"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO, dowOf, isWeekend } from "@/lib/date";
import { EDITABLE_TYPES, type EditableType } from "@/lib/attendance";
import type {
  ActionResult,
  BackdatedAttendanceInput,
  EditAttendanceInput,
} from "./types";

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

  const { error } = await supabase
    .from("attendance_logs")
    .upsert(
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

  revalidatePath("/");
  revalidatePath("/history");
  return { ok: true };
}

/** Shared authentication + role lookup for the edit/delete/backdate paths. */
async function getActor(): Promise<
  | { ok: false; error: string }
  | { ok: true; userId: string; role: string }
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

function isLocked(row: { source: string; status: string }): boolean {
  return row.source === "leave_request" && row.status === "approved";
}

/**
 * Edit an existing attendance_logs row from the Day Detail modal.
 *
 * Authorization (defense in depth — RLS also enforces ownership via
 * attendance_self_update / attendance_hr_all):
 *   - HR/admin → may edit any row, locked or not.
 *   - Owner   → may edit own row, UNLESS it's locked (source=
 *     'leave_request' AND status='approved' — those came through the
 *     approval flow and editing here would silently bypass it).
 *   - Anyone else → 403.
 *
 * Always writes an audit_log entry with { before, after } details.
 */
export async function editAttendanceAction(
  input: EditAttendanceInput,
): Promise<ActionResult> {
  const auth = await getActor();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("attendance_logs")
    .select(
      "id, employee_id, date, type, half, reason, status, source, slack_message_ts, created_by, created_at, updated_at",
    )
    .eq("id", input.logId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Entry not found" };

  const userOwns = before.employee_id === auth.userId;
  if (!isHr(auth.role) && !userOwns) {
    return { ok: false, error: "Not authorized to edit this entry" };
  }
  if (!isHr(auth.role) && isLocked(before)) {
    return {
      ok: false,
      error: "Approved leave entries can only be changed by HR",
    };
  }
  if (!EDITABLE_TYPES.includes(input.type as EditableType)) {
    return { ok: false, error: "Invalid type" };
  }
  if (input.type !== "half_leave" && input.half !== "full") {
    return { ok: false, error: "Half only applies to half-leave entries" };
  }

  const patch = {
    type: input.type,
    half: input.half,
    reason: input.reason?.trim() || null,
    // Web-driven edits become "confirmed" (no longer auto-logged).
    status: "confirmed" as const,
    updated_at: new Date().toISOString(),
  };

  const { error: updateErr } = await admin
    .from("attendance_logs")
    .update(patch)
    .eq("id", input.logId);
  if (updateErr) return { ok: false, error: updateErr.message };

  // HR editing someone else's row gets a distinct audit action so we can
  // grep / report on cross-employee changes separately from self-edits.
  const hrOnOthers = isHr(auth.role) && !userOwns;

  await admin.from("audit_log").insert({
    actor_id: auth.userId,
    action: hrOnOthers ? "attendance_edited_by_hr" : "attendance_edited",
    target_type: "attendance_log",
    target_id: input.logId,
    details: {
      before: {
        type: before.type,
        half: before.half,
        reason: before.reason,
        status: before.status,
      },
      after: patch,
      ...(hrOnOthers
        ? {
            actor_id: auth.userId,
            target_employee_id: before.employee_id,
          }
        : null),
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath(`/admin/employees/${before.employee_id}`);
  return { ok: true };
}

/** Delete an attendance_logs row. HR/admin only per spec. */
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
    .select(
      "id, employee_id, date, type, half, reason, status, source",
    )
    .eq("id", logId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Entry not found" };

  const { error } = await admin
    .from("attendance_logs")
    .delete()
    .eq("id", logId);
  if (error) return { ok: false, error: error.message };

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
 * Insert a backdated attendance_logs row for a past empty weekday cell.
 *
 * Authorization:
 *   - Owner may add for themselves on a date < today (and not a weekend).
 *   - HR/admin may add for any employee on any past date.
 *   - The date must not already have an entry (we INSERT with the
 *     (employee_id, date) UNIQUE — collisions return a clear error).
 *
 * source='web_backdated', status='confirmed'. Audit:
 * action='attendance_added_backdated'.
 */
export async function addBackdatedAttendanceAction(
  input: BackdatedAttendanceInput,
): Promise<ActionResult> {
  const auth = await getActor();
  if (!auth.ok) return auth;

  const employeeId = input.employeeId ?? auth.userId;
  if (employeeId !== auth.userId && !isHr(auth.role)) {
    return { ok: false, error: "Not authorized" };
  }

  if (input.date >= todayISO()) {
    return { ok: false, error: "Backdated entries must be in the past" };
  }
  if (isWeekend(input.date) || dowOf(input.date) === 0 || dowOf(input.date) === 6) {
    return { ok: false, error: "Pick a weekday" };
  }
  if (!EDITABLE_TYPES.includes(input.type as EditableType)) {
    return { ok: false, error: "Invalid type" };
  }
  if (input.type !== "half_leave" && input.half !== "full") {
    return { ok: false, error: "Half only applies to half-leave entries" };
  }

  const admin = createAdminClient();
  // Soft check for an existing row before insert, so we can return a clean
  // error message instead of a PG unique-violation.
  const { data: existing } = await admin
    .from("attendance_logs")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("date", input.date)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: "An entry already exists for that day — edit it instead",
    };
  }

  const { data: inserted, error } = await admin
    .from("attendance_logs")
    .insert({
      employee_id: employeeId,
      date: input.date,
      type: input.type,
      half: input.half,
      reason: input.reason?.trim() || null,
      status: "confirmed",
      source: "web_backdated",
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  await admin.from("audit_log").insert({
    actor_id: auth.userId,
    action: "attendance_added_backdated",
    target_type: "attendance_log",
    target_id: inserted.id,
    details: {
      after: {
        employee_id: employeeId,
        date: input.date,
        type: input.type,
        half: input.half,
        reason: input.reason ?? null,
      },
      ...(employeeId !== auth.userId
        ? { actor_id: auth.userId, target_employee_id: employeeId }
        : null),
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath(`/admin/employees/${employeeId}`);
  return { ok: true };
}
