import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminEmployee = {
  id: string;
  full_name: string;
  email: string;
  role: "employee" | "team_lead" | "hr" | "admin";
  team_id: string | null;
  slack_user_id: string | null;
};

/**
 * Server-side role gate for /admin/* pages.
 *
 *  - kind: "hr_or_admin" — HR + admin only
 *  - kind: "team_lead"   — anyone leading at least one team (or HR/admin)
 *
 * Redirects unauthenticated users to /login. Returns the actor's row +
 * whether they lead a team. Layered on top of RLS, but pages reach into
 * the admin client for cross-team reads, so the gate is the only check
 * keeping non-HR users out.
 */
export async function requireAdminEmployee(opts: {
  kind: "hr_or_admin" | "team_lead";
}): Promise<{
  actor: AdminEmployee;
  isHr: boolean;
  ledTeamIds: string[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: actor } = await admin
    .from("employees")
    .select("id, full_name, email, role, team_id, slack_user_id")
    .eq("id", user.id)
    .maybeSingle<AdminEmployee>();
  if (!actor) redirect("/");

  const isHr = actor.role === "hr" || actor.role === "admin";

  // Look up which teams (if any) this user leads.
  const { data: ledTeams } = await admin
    .from("teams")
    .select("id")
    .eq("lead_id", actor.id);
  const ledTeamIds = (ledTeams ?? []).map((t) => t.id);

  if (opts.kind === "hr_or_admin" && !isHr) redirect("/admin/team");
  if (opts.kind === "team_lead" && !isHr && ledTeamIds.length === 0) {
    redirect("/");
  }

  return { actor, isHr, ledTeamIds };
}
