import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { ApprovalsList } from "@/components/leave/approvals-list";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApproversFor, canActOn } from "@/lib/leave/routing";
import type { ApproverEmployee, LeaveRequest } from "@/lib/leave/types";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: actor } = await admin
    .from("employees")
    .select("id, full_name, email, role, slack_user_id, team_id")
    .eq("id", user.id)
    .maybeSingle<ApproverEmployee>();

  if (!actor) redirect("/");

  const isHr = actor.role === "hr" || actor.role === "admin";

  // Fetch the candidate set: pending requests routed to me.
  // - HR/admin sees all pending
  // - Team lead sees pending requests from their team members (excluding self)
  const { data: pendingRows } = isHr
    ? await admin
        .from("leave_requests")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
    : await admin
        .from("leave_requests")
        .select(
          "*, employee:employees!employee_id ( id, full_name, team_id )",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: true });

  type RowMaybeWithEmployee = LeaveRequest & {
    employee?: { id: string; full_name: string; team_id: string | null };
  };

  let pending = ((pendingRows ?? []) as RowMaybeWithEmployee[]).filter((r) => {
    if (isHr) return true;
    return r.employee?.team_id === actor.team_id && r.employee.id !== actor.id;
  });

  // Compute routing per request to filter out the ones currently escalated
  // away from this lead (and to flag escalated rows for HR).
  const augmented = await Promise.all(
    pending.map(async (r) => {
      const routing = await getApproversFor(admin, r);
      const allowed = canActOn(actor, r, routing);
      return { request: r as LeaveRequest, routing, allowed };
    }),
  );

  pending = []; // free reference

  // Pull requester name + team name for display.
  const requesterIds = [...new Set(augmented.map((a) => a.request.employee_id))];
  const requesters = requesterIds.length
    ? await admin
        .from("employees")
        .select(`id, full_name, team:teams!team_id ( id, name )`)
        .in("id", requesterIds)
    : { data: [] };

  type RequesterRow = {
    id: string;
    full_name: string;
    team: { id: string; name: string } | null;
  };
  const requesterMap = new Map<string, RequesterRow>(
    ((requesters.data as RequesterRow[]) ?? []).map((r) => [r.id, r]),
  );

  // Filter to ones the actor can act on — escalated team-lead routes drop off.
  const visible = augmented.filter((a) => a.allowed);

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Pending approvals
          </h1>
          <p className="text-sm text-muted-foreground">
            {isHr
              ? "Every pending leave request, including ones escalated past their team lead."
              : "Leave requests from your team that need your decision."}
          </p>
        </div>

        {visible.length === 0 ? (
          <Card>
            <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
              Nothing pending right now. :tada:
            </CardContent>
          </Card>
        ) : (
          <ApprovalsList
            items={visible.map((v) => {
              const r = requesterMap.get(v.request.employee_id);
              return {
                request: v.request,
                requesterName: r?.full_name ?? "Unknown",
                requesterTeam: r?.team?.name ?? null,
                escalated: v.routing.escalated,
              };
            })}
          />
        )}
      </main>
    </div>
  );
}
