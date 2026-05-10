import { createAdminClient } from "@/lib/supabase/admin";
import { sendLeaveApprovalDM } from "@/lib/slack/leave-dm";
import { findTeamConflicts } from "./conflicts";
import { fetchHolidaySet } from "./holidays";
import { countWorkingDays } from "./working-days";
import { getApproversFor } from "./routing";
import {
  LEAVE_TYPE_LABEL,
  type LeaveRequest,
  type LeaveType,
} from "./types";

export interface SubmitInput {
  employeeId: string;
  type: LeaveType;
  fromDate: string;
  toDate: string;
  reason: string | null;
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  requestId?: string;
  routedTo?: "team_lead" | "hr";
  approverCount?: number;
}

/**
 * Insert a leave_requests row, compute who should approve, DM them, and
 * write a 'leave_request_notified' audit entry capturing the DM channel +
 * ts so we can later edit the message in-place.
 */
export async function submitLeaveRequest(
  input: SubmitInput,
): Promise<SubmitResult> {
  if (input.toDate < input.fromDate) {
    return { ok: false, error: "End date is before start date" };
  }

  const admin = createAdminClient();

  const { data: requester } = await admin
    .from("employees")
    .select(
      `id, full_name, email, role, slack_user_id, team_id,
       team:teams!team_id ( id, name, lead_id )`,
    )
    .eq("id", input.employeeId)
    .maybeSingle<{
      id: string;
      full_name: string;
      team_id: string | null;
      team: { name: string } | null;
    }>();

  if (!requester) return { ok: false, error: "Employee not found" };

  const { data: created, error: insertErr } = await admin
    .from("leave_requests")
    .insert({
      employee_id: input.employeeId,
      type: input.type,
      from_date: input.fromDate,
      to_date: input.toDate,
      reason: input.reason,
      status: "pending",
    })
    .select("*")
    .single<LeaveRequest>();

  if (insertErr || !created) {
    return { ok: false, error: insertErr?.message ?? "Insert failed" };
  }

  const routing = await getApproversFor(admin, created);

  // Compute conflicts + working days + balance preview for the DM.
  const holidays = await fetchHolidaySet(
    admin,
    input.fromDate,
    input.toDate,
  );
  const workingDays = countWorkingDays(
    input.fromDate,
    input.toDate,
    holidays,
  );

  const conflicts = await findTeamConflicts(admin, {
    teamId: requester.team_id,
    excludeEmployeeId: requester.id,
    fromISO: input.fromDate,
    toISO: input.toDate,
  });

  const { data: bal } = await admin
    .from("v_employee_balances")
    .select(`${input.type}_allowance, ${input.type}_used`)
    .eq("employee_id", input.employeeId)
    .maybeSingle();
  const allowance = (bal as Record<string, number> | null)?.[
    `${input.type}_allowance`
  ];
  const used = (bal as Record<string, number> | null)?.[
    `${input.type}_used`
  ];
  const balanceAfter =
    typeof allowance === "number" && typeof used === "number"
      ? allowance - used - workingDays
      : null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const webUrl = `${appUrl}/approvals`;

  const dmTargets: { approver_id: string; channel: string; ts: string }[] = [];
  for (const approver of routing.approvers) {
    if (!approver.slack_user_id) continue;
    const { channel, ts } = await sendLeaveApprovalDM({
      request: created,
      requesterName: requester.full_name,
      requesterTeam: requester.team?.name ?? null,
      workingDays,
      balanceAfter,
      conflicts,
      approverSlackId: approver.slack_user_id,
      webUrl,
    });
    if (channel && ts) {
      dmTargets.push({ approver_id: approver.id, channel, ts });
    }
  }

  if (dmTargets.length > 0) {
    await admin.from("audit_log").insert({
      actor_id: null,
      action: "leave_request_notified",
      target_type: "leave_request",
      target_id: created.id,
      details: {
        routed_to: routing.routeTo,
        type: LEAVE_TYPE_LABEL[input.type],
        dm_targets: dmTargets,
      },
    });
  }

  return {
    ok: true,
    requestId: created.id,
    routedTo: routing.routeTo,
    approverCount: routing.approvers.length,
  };
}
