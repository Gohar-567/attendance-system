"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideLeaveRequest } from "@/lib/leave/decide";
import { expandLeaveToAttendance } from "@/lib/leave/expand";
import { getApproversFor, canActOn } from "@/lib/leave/routing";
import { submitLeaveRequest } from "@/lib/leave/submit";
import type { ApproverEmployee, LeaveRequest, LeaveType } from "@/lib/leave/types";
import type {
  DecideLeaveAction,
  GrantLeaveInput,
  LeaveActionResult,
} from "./types";

export async function submitLeaveAction(input: {
  type: LeaveType;
  fromDate: string;
  toDate: string;
  reason: string | null;
}): Promise<LeaveActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const result = await submitLeaveRequest({
    employeeId: user.id,
    type: input.type,
    fromDate: input.fromDate,
    toDate: input.toDate,
    reason: input.reason,
  });

  if (result.ok) {
    revalidatePath("/leave");
    revalidatePath("/approvals");
    revalidatePath("/");
  }
  return {
    ok: result.ok,
    error: result.error,
    requestId: result.requestId,
  };
}

export async function decideLeaveAction(input: {
  requestId: string;
  action: DecideLeaveAction;
  note: string | null;
}): Promise<LeaveActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const admin = createAdminClient();
  const { data: actor } = await admin
    .from("employees")
    .select("id, full_name, email, role, slack_user_id, team_id")
    .eq("id", user.id)
    .maybeSingle<ApproverEmployee>();
  if (!actor) return { ok: false, error: "Employee record missing" };

  const { data: request } = await admin
    .from("leave_requests")
    .select("id, employee_id, created_at, status")
    .eq("id", input.requestId)
    .maybeSingle<Pick<LeaveRequest, "id" | "employee_id" | "created_at" | "status">>();
  if (!request) return { ok: false, error: "Request not found" };

  const routing = await getApproversFor(admin, request);
  if (!canActOn(actor, request, routing)) {
    return { ok: false, error: "You're not authorized to act on this request" };
  }

  const result = await decideLeaveRequest({
    requestId: input.requestId,
    decider: actor,
    action: input.action,
    note: input.note,
  });

  if (result.ok) {
    revalidatePath("/approvals");
    revalidatePath("/leave");
    revalidatePath("/");
  }
  return result;
}

/**
 * HR/admin grants an approved leave for any employee directly — no apply /
 * approve round-trip. Inserts an approved leave_request (source='hr_manual')
 * so the balance cards move immediately, then expands it into attendance_logs
 * exactly like a normally-approved request. Reuses expandLeaveToAttendance so
 * the calendar + balance stay consistent with the standard flow.
 */
export async function grantLeaveAction(
  input: GrantLeaveInput,
): Promise<LeaveActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const admin = createAdminClient();
  const { data: actor } = await admin
    .from("employees")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; role: string }>();
  if (!actor || (actor.role !== "hr" && actor.role !== "admin")) {
    return { ok: false, error: "Only HR can grant leave" };
  }

  if (!["casual", "sick", "annual"].includes(input.type)) {
    return { ok: false, error: "Invalid leave type" };
  }
  if (!input.fromDate || !input.toDate) {
    return { ok: false, error: "Both dates are required" };
  }
  if (input.toDate < input.fromDate) {
    return { ok: false, error: "End date is before start date" };
  }

  const { data: employee } = await admin
    .from("employees")
    .select("id")
    .eq("id", input.employeeId)
    .maybeSingle<{ id: string }>();
  if (!employee) return { ok: false, error: "Employee not found" };

  const { data: created, error: insertErr } = await admin
    .from("leave_requests")
    .insert({
      employee_id: input.employeeId,
      type: input.type,
      from_date: input.fromDate,
      to_date: input.toDate,
      reason: input.reason,
      status: "approved",
      approver_id: actor.id,
      decided_at: new Date().toISOString(),
      source: "hr_manual",
    })
    .select("*")
    .single<LeaveRequest>();

  if (insertErr || !created) {
    return { ok: false, error: insertErr?.message ?? "Couldn't grant leave" };
  }

  const { daysWritten } = await expandLeaveToAttendance(admin, created, actor.id);

  await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: "granted_leave",
    target_type: "leave_request",
    target_id: created.id,
    details: {
      target_employee_id: input.employeeId,
      type: input.type,
      from_date: input.fromDate,
      to_date: input.toDate,
      days_written: daysWritten,
    },
  });

  revalidatePath("/");
  revalidatePath("/leave");
  revalidatePath(`/admin/employees/${input.employeeId}`);
  return { ok: true, requestId: created.id };
}

export async function cancelOwnLeaveAction(
  requestId: string,
): Promise<LeaveActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // RLS policy `leave_self_cancel` allows owners to update pending rows.
  const { error } = await supabase
    .from("leave_requests")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("employee_id", user.id)
    .eq("status", "pending");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/leave");
  revalidatePath("/approvals");
  return { ok: true };
}
