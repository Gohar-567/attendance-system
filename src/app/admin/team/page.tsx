import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { TodayCountsStrip } from "@/components/admin/today-counts";
import { TeamGrid } from "@/components/admin/team-grid";
import { AdminApprovalsCard } from "@/components/admin/admin-approvals";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminEmployee } from "@/lib/admin/guard";
import {
  bucketCounts,
  fetchTodaySnapshot,
} from "@/lib/admin/today";
import { canActOn, getApproversFor } from "@/lib/leave/routing";
import type { ApprovalItem } from "@/components/leave/approvals-list";
import type { ApproverEmployee, LeaveRequest } from "@/lib/leave/types";

export const dynamic = "force-dynamic";

export default async function TeamLeadDashboardPage() {
  const { actor, isHr, ledTeamIds } = await requireAdminEmployee({
    kind: "team_lead",
  });

  // HR landing here gets bounced to the full HR view.
  if (isHr) redirect("/admin");

  const admin = createAdminClient();
  const teamId = ledTeamIds[0]; // a lead leads exactly one team in v1

  const { data: team } = await admin
    .from("teams")
    .select("id, name")
    .eq("id", teamId)
    .maybeSingle<{ id: string; name: string }>();

  // Today snapshot scoped to the team.
  const snapshot = await fetchTodaySnapshot({ teamId });
  const counts = bucketCounts(snapshot);

  // Pending leave requests where this user is currently authorized.
  const { data: teamMembers } = await admin
    .from("employees")
    .select("id")
    .eq("team_id", teamId)
    .eq("is_active", true)
    .neq("id", actor.id);
  const teamMemberIds = (teamMembers ?? []).map((m) => m.id);

  const { data: pendingRows } = teamMemberIds.length
    ? await admin
        .from("leave_requests")
        .select("*")
        .in("employee_id", teamMemberIds)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
    : { data: [] };

  const pending = (pendingRows ?? []) as LeaveRequest[];
  const items: ApprovalItem[] = [];
  for (const req of pending) {
    const routing = await getApproversFor(admin, req);
    if (!canActOn(actor as ApproverEmployee, req, routing)) continue;
    const { data: requester } = await admin
      .from("employees")
      .select("full_name")
      .eq("id", req.employee_id)
      .maybeSingle();
    items.push({
      request: req,
      requesterName: requester?.full_name ?? "Unknown",
      requesterTeam: team?.name ?? null,
      escalated: routing.escalated,
      routingBadge: "→ You",
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {team?.name ?? "Team"} · today
          </h1>
          <p className="text-sm text-muted-foreground">
            Your team&apos;s status right now and any leave requests that
            need your call.
          </p>
        </div>

        <TodayCountsStrip counts={counts} />

        <AdminApprovalsCard
          items={items}
          emptyText="No pending requests from your team."
        />

        <div>
          <h2 className="mb-2 text-sm font-semibold tracking-tight">
            Team grid
          </h2>
          <TeamGrid rows={snapshot} filterByTeam={false} />
        </div>
      </main>
    </div>
  );
}
