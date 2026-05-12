import Link from "next/link";

import { TopBar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { TodayCountsStrip } from "@/components/admin/today-counts";
import { TeamGrid } from "@/components/admin/team-grid";
import { ParserStatsCard } from "@/components/admin/parser-stats-card";
import { AdminApprovalsCard } from "@/components/admin/admin-approvals";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminEmployee } from "@/lib/admin/guard";
import {
  bucketCounts,
  fetchTodaySnapshot,
} from "@/lib/admin/today";
import { fetchParserStats24h } from "@/lib/admin/parser-stats";
import { getApproversFor } from "@/lib/leave/routing";
import type { ApprovalItem } from "@/components/leave/approvals-list";
import type { LeaveRequest } from "@/lib/leave/types";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const { actor } = await requireAdminEmployee({ kind: "hr_or_admin" });

  const admin = createAdminClient();

  const [snapshot, parserStats, pendingRows] = await Promise.all([
    fetchTodaySnapshot(),
    fetchParserStats24h(),
    admin
      .from("leave_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  const counts = bucketCounts(snapshot);

  const pending = (pendingRows.data ?? []) as LeaveRequest[];

  // Resolve routing + decorate for the approvals card.
  const requesterIds = [...new Set(pending.map((p) => p.employee_id))];
  const requestersRes = requesterIds.length
    ? await admin
        .from("employees")
        .select(`id, full_name, team_id, team:teams!team_id ( id, name, lead_id )`)
        .in("id", requesterIds)
    : { data: [] };
  type Req = {
    id: string;
    full_name: string;
    team_id: string | null;
    team: { id: string; name: string; lead_id: string | null } | null;
  };
  const requesterMap = new Map<string, Req>(
    ((requestersRes.data as Req[]) ?? []).map((r) => [r.id, r]),
  );

  // For each request, fetch the lead's name (when routed to lead) so the
  // routing badge can display "→ Jane Doe".
  const items: ApprovalItem[] = await Promise.all(
    pending.map(async (req) => {
      const routing = await getApproversFor(admin, req);
      const requester = requesterMap.get(req.employee_id);
      let routingBadge = "→ HR";
      if (routing.routeTo === "team_lead" && routing.approvers[0]) {
        routingBadge = `→ ${routing.approvers[0].full_name}`;
      }
      if (routing.approvers.some((a) => a.id === actor.id)) {
        routingBadge += " · You";
      }
      return {
        request: req,
        requesterName: requester?.full_name ?? "Unknown",
        requesterTeam: requester?.team?.name ?? null,
        escalated: routing.escalated,
        routingBadge,
      };
    }),
  );

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              HR dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Today across the org. Manage employees + teams, run reports,
              spot Slack-parser issues.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin/report">Monthly report</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/api/export?month=${new Date().toISOString().slice(0, 7)}&team=all`}>
                Export Excel
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/employees">Manage</Link>
            </Button>
          </div>
        </div>

        <TodayCountsStrip counts={counts} />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AdminApprovalsCard items={items} />
          </div>
          <div>
            <ParserStatsCard stats={parserStats} />
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold tracking-tight">
            Team grid · today
          </h2>
          <TeamGrid rows={snapshot} />
        </div>
      </main>
    </div>
  );
}
