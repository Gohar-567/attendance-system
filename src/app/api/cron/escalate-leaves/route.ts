import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendLeaveApprovalDM } from "@/lib/slack/leave-dm";
import { findTeamConflicts } from "@/lib/leave/conflicts";
import { fetchHolidaySet } from "@/lib/leave/holidays";
import { countWorkingDays } from "@/lib/leave/working-days";
import { ESCALATION_HOURS, type LeaveRequest } from "@/lib/leave/types";

export const runtime = "nodejs";

/**
 * Daily escalation cron. Runs once per day from Vercel.
 *
 * For every pending leave_requests row created more than 48h ago that hasn't
 * already been escalated, DM each HR/admin with a fresh approval card and
 * record an audit row so we don't re-DM tomorrow.
 *
 * Vercel attaches `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
 * set on the project; we verify it here.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - ESCALATION_HOURS * 60 * 60 * 1000)
    .toISOString();

  const { data: pendingRows } = await admin
    .from("leave_requests")
    .select("*")
    .eq("status", "pending")
    .lte("created_at", cutoff);

  const pending = (pendingRows ?? []) as LeaveRequest[];
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, escalated: 0, scanned: 0 });
  }

  // Skip requests that already have a 'leave_request_escalated' audit entry.
  const ids = pending.map((p) => p.id);
  const { data: alreadyEscalated } = await admin
    .from("audit_log")
    .select("target_id")
    .eq("action", "leave_request_escalated")
    .eq("target_type", "leave_request")
    .in("target_id", ids);
  const escalatedSet = new Set(
    (alreadyEscalated ?? []).map((r) => r.target_id),
  );

  const toEscalate = pending.filter((p) => !escalatedSet.has(p.id));
  if (toEscalate.length === 0) {
    return NextResponse.json({
      ok: true,
      escalated: 0,
      scanned: pending.length,
    });
  }

  // Pull every active HR/admin (escalation target).
  const { data: hrRows } = await admin
    .from("employees")
    .select("id, full_name, email, role, slack_user_id, team_id")
    .in("role", ["hr", "admin"])
    .eq("is_active", true);
  const hrUsers = (hrRows ?? []).filter((h) => h.slack_user_id);

  let escalatedCount = 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const webUrl = `${appUrl}/approvals`;

  for (const request of toEscalate) {
    const { data: requester } = await admin
      .from("employees")
      .select(
        `id, full_name, team_id, team:teams!team_id ( id, name )`,
      )
      .eq("id", request.employee_id)
      .maybeSingle<{
        id: string;
        full_name: string;
        team_id: string | null;
        team: { id: string; name: string } | null;
      }>();
    if (!requester) continue;

    const holidays = await fetchHolidaySet(
      admin,
      request.from_date,
      request.to_date,
    );
    const workingDays = countWorkingDays(
      request.from_date,
      request.to_date,
      holidays,
    );
    const conflicts = await findTeamConflicts(admin, {
      teamId: requester.team_id,
      excludeEmployeeId: requester.id,
      fromISO: request.from_date,
      toISO: request.to_date,
    });

    const { data: bal } = await admin
      .from("v_employee_balances")
      .select(`${request.type}_allowance, ${request.type}_used`)
      .eq("employee_id", requester.id)
      .maybeSingle();
    const balRecord = bal as Record<string, number> | null;
    const balanceAfter =
      balRecord
        ? balRecord[`${request.type}_allowance`] -
          balRecord[`${request.type}_used`] -
          workingDays
        : null;

    const dmTargets: { approver_id: string; channel: string; ts: string }[] =
      [];
    for (const hr of hrUsers) {
      if (!hr.slack_user_id) continue;
      const { channel, ts } = await sendLeaveApprovalDM({
        request,
        requesterName: requester.full_name,
        requesterTeam: requester.team?.name ?? null,
        workingDays,
        balanceAfter,
        conflicts,
        approverSlackId: hr.slack_user_id,
        webUrl,
      });
      if (channel && ts) {
        dmTargets.push({ approver_id: hr.id, channel, ts });
      }
    }

    await admin.from("audit_log").insert([
      {
        actor_id: null,
        action: "leave_request_escalated",
        target_type: "leave_request",
        target_id: request.id,
        details: {
          age_hours: Math.round(
            (Date.now() - new Date(request.created_at).getTime()) / 36e5,
          ),
          notified_count: dmTargets.length,
        },
      },
      // Reuse the same notified entry shape so decide() can edit these too.
      ...(dmTargets.length > 0
        ? [
            {
              actor_id: null,
              action: "leave_request_notified",
              target_type: "leave_request",
              target_id: request.id,
              details: { routed_to: "hr", dm_targets: dmTargets },
            },
          ]
        : []),
    ]);

    escalatedCount++;
  }

  return NextResponse.json({
    ok: true,
    escalated: escalatedCount,
    scanned: pending.length,
  });
}
