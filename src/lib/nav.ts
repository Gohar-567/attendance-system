import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type EmployeeRole = "employee" | "team_lead" | "hr" | "admin";

export interface NavContext {
  authUserId: string;
  fullName: string;
  teamName: string | null;
  role: EmployeeRole;
  isHr: boolean;
  isLead: boolean;
}

/**
 * Server-side fetch for everything the TopBar + role gates need. Called
 * once per request from the TopBar; pages don't have to pass it around.
 *
 * Returns null if the user is signed in but has no employees row yet —
 * the TopBar renders a minimal "Sign out / Settings" header in that case.
 */
export async function getNavContext(): Promise<NavContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("employees")
    .select(
      `id, full_name, role, team:teams!team_id ( id, name )`,
    )
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      full_name: string;
      role: EmployeeRole;
      team: { id: string; name: string } | null;
    }>();

  if (!row) {
    return {
      authUserId: user.id,
      fullName: user.email ?? "Account",
      teamName: null,
      role: "employee",
      isHr: false,
      isLead: false,
    };
  }

  const { count } = await admin
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", row.id);

  const isHr = row.role === "hr" || row.role === "admin";
  const isLead = (count ?? 0) > 0;

  return {
    authUserId: row.id,
    fullName: row.full_name,
    teamName: row.team?.name ?? null,
    role: row.role,
    isHr,
    isLead,
  };
}
