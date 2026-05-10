import type { SupabaseClient } from "@supabase/supabase-js";

import { ESCALATION_HOURS, type ApproverEmployee, type LeaveRequest } from "./types";

export interface ApproverRouting {
  /**
   * Who should be DM'd / shown the request when it's first created.
   *  - "team_lead": one specific lead
   *  - "hr": all HR + admin
   */
  routeTo: "team_lead" | "hr";
  approvers: ApproverEmployee[];
  /** True if the request escalated to HR because the lead never acted. */
  escalated: boolean;
}

/**
 * Resolve who the request currently routes to. Implements §3 of the manifest:
 *
 *   - Default: the requester's team's lead
 *   - If the requester *is* the lead → HR
 *   - If the team has no lead → HR
 *   - If pending > 48h → escalate to HR regardless
 */
export async function getApproversFor(
  admin: SupabaseClient,
  request: Pick<LeaveRequest, "id" | "employee_id" | "created_at" | "status">,
): Promise<ApproverRouting> {
  // Look up the requester's team + that team's lead.
  const { data: requester } = await admin
    .from("employees")
    .select(
      `id, full_name, email, role, slack_user_id, team_id,
       team:teams!team_id ( id, name, lead_id )`,
    )
    .eq("id", request.employee_id)
    .maybeSingle<{
      id: string;
      full_name: string;
      email: string;
      role: ApproverEmployee["role"];
      slack_user_id: string | null;
      team_id: string | null;
      team: { id: string; name: string; lead_id: string | null } | null;
    }>();

  const ageHours =
    (Date.now() - new Date(request.created_at).getTime()) / 36e5;
  const escalated = ageHours >= ESCALATION_HOURS;

  let routeTo: "team_lead" | "hr" = "hr";
  let leadId: string | null = null;

  if (!escalated && requester?.team?.lead_id) {
    // Requester is the lead → HR. Otherwise route to lead.
    if (requester.team.lead_id !== requester.id) {
      routeTo = "team_lead";
      leadId = requester.team.lead_id;
    }
  }

  if (routeTo === "team_lead" && leadId) {
    const { data: lead } = await admin
      .from("employees")
      .select("id, full_name, email, role, slack_user_id, team_id")
      .eq("id", leadId)
      .maybeSingle();
    if (lead) {
      return {
        routeTo: "team_lead",
        approvers: [lead as ApproverEmployee],
        escalated: false,
      };
    }
    // Lead row missing — fall through to HR.
  }

  const { data: hrRows } = await admin
    .from("employees")
    .select("id, full_name, email, role, slack_user_id, team_id")
    .in("role", ["hr", "admin"])
    .eq("is_active", true);

  return {
    routeTo: "hr",
    approvers: (hrRows ?? []) as ApproverEmployee[],
    escalated,
  };
}

/**
 * Predicate used by /approvals + the decide endpoint.
 * Returns true if `actor` is allowed to act on `request` right now.
 */
export function canActOn(
  actor: ApproverEmployee,
  request: Pick<LeaveRequest, "employee_id" | "created_at" | "status">,
  routing: ApproverRouting,
): boolean {
  if (request.status !== "pending") return false;
  if (actor.role === "hr" || actor.role === "admin") return true;
  // Non-HR can only act if the routing currently includes them
  // (i.e. they're the team lead AND the request hasn't escalated).
  if (routing.escalated) return false;
  return routing.approvers.some((a) => a.id === actor.id);
}
