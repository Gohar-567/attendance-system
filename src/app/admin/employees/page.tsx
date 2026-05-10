import { TopBar } from "@/components/topbar";
import { EmployeesTable } from "@/components/admin/employees-table";
import { requireAdminEmployee } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export interface ManagedEmployee {
  id: string;
  full_name: string;
  email: string;
  team_id: string | null;
  team_name: string | null;
  role: "employee" | "team_lead" | "hr" | "admin";
  join_date: string;
  is_active: boolean;
  slack_user_id: string | null;
  leave_allowances: { casual: number; sick: number; annual: number };
}

export default async function ManageEmployeesPage() {
  const { actor } = await requireAdminEmployee({ kind: "hr_or_admin" });
  const admin = createAdminClient();

  const [empRes, teamRes] = await Promise.all([
    admin
      .from("employees")
      .select(
        `id, full_name, email, team_id, role, join_date, is_active, slack_user_id, leave_allowances,
         team:teams!team_id ( id, name )`,
      )
      .order("is_active", { ascending: false })
      .order("full_name"),
    admin.from("teams").select("id, name").order("name"),
  ]);

  type Row = {
    id: string;
    full_name: string;
    email: string;
    team_id: string | null;
    role: ManagedEmployee["role"];
    join_date: string;
    is_active: boolean;
    slack_user_id: string | null;
    leave_allowances: { casual: number; sick: number; annual: number };
    team: { id: string; name: string } | null;
  };
  const employees: ManagedEmployee[] = ((empRes.data as unknown as Row[]) ?? []).map(
    (r) => ({
      ...r,
      team_name: r.team?.name ?? null,
    }),
  );
  const teams = ((teamRes.data ?? []) as { id: string; name: string }[]) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <TopBar fullName={actor.full_name} teamName={null} adminLink="hr" />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Manage employees
          </h1>
          <p className="text-sm text-muted-foreground">
            Add, edit, and deactivate employees. Soft-deleted rows stay so
            attendance history doesn&apos;t disappear.
          </p>
        </div>

        <EmployeesTable employees={employees} teams={teams} />
      </main>
    </div>
  );
}
