import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { dmSlackUser } from "@/lib/slack/identity";
import { editDmAfterDecision } from "@/lib/slack/leave-dm";
import { longDate } from "@/lib/date";
import { expandLeaveToAttendance } from "./expand";
import {
  LEAVE_TYPE_LABEL,
  type ApproverEmployee,
  type LeaveRequest,
} from "./types";

export type DecideAction = "approve" | "reject";

export interface DecideResult {
  ok: boolean;
  error?: string;
  daysWritten?: number;
}

interface DmTarget {
  approver_id: string;
  channel: string;
  ts: string;
}

/**
 * Single source of truth for approving / rejecting a leave request. Called
 * from the web /approvals page and from /api/slack/interactions so the two
 * flows stay in lock-step.
 *
 * Steps:
 *   1. Re-read the request inside the admin client (avoids RLS gotchas).
 *   2. Verify it's still pending.
 *   3. Update the row with status / approver / decided_at / decision_note.
 *   4. On approve: expand into attendance_logs.
 *   5. Write an audit_log entry (action: approved_leave / rejected_leave).
 *   6. DM the requester + edit any pending Slack approval DMs.
 */
export async function decideLeaveRequest(opts: {
  requestId: string;
  decider: ApproverEmployee;
  action: DecideAction;
  note: string | null;
}): Promise<DecideResult> {
  const admin = createAdminClient();
  const { requestId, decider, action, note } = opts;

  const { data: request } = await admin
    .from("leave_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle<LeaveRequest>();

  if (!request) return { ok: false, error: "Request not found" };
  if (request.status !== "pending") {
    return { ok: false, error: `Already ${request.status}` };
  }

  const newStatus = action === "approve" ? "approved" : "rejected";

  const { error: updateErr } = await admin
    .from("leave_requests")
    .update({
      status: newStatus,
      approver_id: decider.id,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq("id", requestId);

  if (updateErr) return { ok: false, error: updateErr.message };

  let daysWritten = 0;
  if (action === "approve") {
    const res = await expandLeaveToAttendance(
      admin,
      { ...request, status: "approved" },
      decider.id,
    );
    daysWritten = res.daysWritten;
  }

  await admin.from("audit_log").insert({
    actor_id: decider.id,
    action: action === "approve" ? "approved_leave" : "rejected_leave",
    target_type: "leave_request",
    target_id: requestId,
    details: {
      decision_note: note,
      days_written: daysWritten,
      previous_status: request.status,
    },
  });

  await notifyRequester(admin, request, decider, action, note);
  await updateApprovalDms(admin, request, decider, action, note);

  return { ok: true, daysWritten };
}

async function notifyRequester(
  admin: SupabaseClient,
  request: LeaveRequest,
  decider: ApproverEmployee,
  action: DecideAction,
  note: string | null,
) {
  const { data: requester } = await admin
    .from("employees")
    .select("id, slack_user_id")
    .eq("id", request.employee_id)
    .maybeSingle();
  if (!requester?.slack_user_id) return;

  const range = `${longDate(request.from_date)} → ${longDate(request.to_date)}`;
  const msg =
    action === "approve"
      ? `:white_check_mark: Your *${LEAVE_TYPE_LABEL[request.type]}* leave (${range}) has been approved by *${decider.full_name}*.`
      : `:x: Your *${LEAVE_TYPE_LABEL[request.type]}* leave (${range}) was rejected by *${decider.full_name}*${note ? ` — ${note}` : ""}.`;
  try {
    await dmSlackUser(requester.slack_user_id, msg);
  } catch (err) {
    console.warn("notifyRequester DM failed", err);
  }
}

async function updateApprovalDms(
  admin: SupabaseClient,
  request: LeaveRequest,
  decider: ApproverEmployee,
  action: DecideAction,
  note: string | null,
) {
  // Pull every "leave_request_notified" audit entry for this request and
  // edit the corresponding Slack message so the buttons disappear.
  const { data: notifyEntries } = await admin
    .from("audit_log")
    .select("details")
    .eq("action", "leave_request_notified")
    .eq("target_type", "leave_request")
    .eq("target_id", request.id);

  const targets: DmTarget[] = [];
  for (const e of notifyEntries ?? []) {
    const list = (e.details?.dm_targets ?? []) as DmTarget[];
    targets.push(...list);
  }

  const { data: requester } = await admin
    .from("employees")
    .select("full_name")
    .eq("id", request.employee_id)
    .maybeSingle();

  await Promise.all(
    targets.map((t) =>
      editDmAfterDecision({
        channel: t.channel,
        ts: t.ts,
        requesterName: requester?.full_name ?? "Someone",
        request,
        decision: action === "approve" ? "approved" : "rejected",
        deciderName: decider.full_name,
        decisionNote: note,
      }),
    ),
  );
}
