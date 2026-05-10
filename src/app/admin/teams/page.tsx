import { TopBar } from "@/components/topbar";
import { TeamsManager } from "@/components/admin/teams-manager";
import { requireAdminEmployee } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export interface ManagedTeam {
  id: string;
  name: string;
  lead_id: string | null;
  lead_name: string | null;
  member_count: number;
  members: { id: string; full_name: string }[];
}

export default async function ManageTeamsPage() {
  const { actor } = await requireAdminEmployee({ kind: "hr_or_admin" });
  const admin = createAdminClient();

  const [teamsRes, empRes] = await Promise.all([
    admin
      .from("teams")
      .select(`id, name, lead_id, lead:employees!fk_team_lead ( id, full_name )`)
      .order("name"),
    admin
      .from("employees")
      .select("id, full_name, team_id, is_active")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  type RawTeam = {
    id: string;
    name: string;
    lead_id: string | null;
    lead: { id: string; full_name: string } | null;
  };
  type EmpRow = {
    id: string;
    full_name: string;
    team_id: string | null;
    is_active: boolean;
  };

  const allEmployees = (empRes.data ?? []) as EmpRow[];
  const teams: ManagedTeam[] = ((teamsRes.data as unknown as RawTeam[]) ?? []).map(
    (t) => {
      const members = allEmployees.filter((e) => e.team_id === t.id);
      return {
        id: t.id,
        name: t.name,
        lead_id: t.lead_id,
        lead_name: t.lead?.full_name ?? null,
        member_count: members.length,
        members: members.map((m) => ({ id: m.id, full_name: m.full_name })),
      };
    },
  );

  return (
    <div className="min-h-screen bg-background">
      <TopBar fullName={actor.full_name} teamName={null} adminLink="hr" />
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Manage teams
          </h1>
          <p className="text-sm text-muted-foreground">
            Add a team, set its lead, or delete an empty team.
          </p>
        </div>

        <TeamsManager teams={teams} />
      </main>
    </div>
  );
}
