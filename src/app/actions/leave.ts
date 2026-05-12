"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideLeaveRequest } from "@/lib/leave/decide";
import { getApproversFor, canActOn } from "@/lib/leave/routing";
import { submitLeaveRequest } from "@/lib/leave/submit";
import type { ApproverEmployee, LeaveRequest, LeaveType } from "@/lib/leave/types";
import type {
  DecideLeaveAction,
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
