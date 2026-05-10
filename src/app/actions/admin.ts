"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface ActionResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_ALLOWANCES = { casual: 10, sick: 8, annual: 14 } as const;

async function requireHrActor(): Promise<
  | { ok: false; error: string }
  | { ok: true; actorId: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const admin = createAdminClient();
  const { data: actor } = await admin
    .from("employees")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; role: string }>();
  if (!actor || (actor.role !== "hr" && actor.role !== "admin")) {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true, actorId: actor.id };
}

function bumpAdminPaths() {
  revalidatePath("/admin");
  revalidatePath("/admin/team");
  revalidatePath("/admin/employees");
  revalidatePath("/admin/teams");
  revalidatePath("/admin/report");
}

export interface CreateEmployeeInput {
  full_name: string;
  email: string;
  team_id: string | null;
  role: "employee" | "team_lead" | "hr" | "admin";
  join_date: string;
  allowances?: { casual: number; sick: number; annual: number };
}

export async function createEmployeeAction(
  input: CreateEmployeeInput,
): Promise<ActionResult & { employeeId?: string }> {
  const auth = await requireHrActor();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const allowances = input.allowances ?? DEFAULT_ALLOWANCES;

  const { data, error } = await admin
    .from("employees")
    .insert({
      full_name: input.full_name.trim(),
      email: input.email.trim().toLowerCase(),
      team_id: input.team_id,
      role: input.role,
      join_date: input.join_date,
      leave_allowances: allowances,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_log").insert({
    actor_id: auth.actorId,
    action: "employee_created",
    target_type: "employee",
    target_id: data.id,
    details: {
      full_name: input.full_name,
      email: input.email,
      team_id: input.team_id,
      role: input.role,
      allowances,
    },
  });

  bumpAdminPaths();
  return { ok: true, employeeId: data.id };
}

export interface UpdateEmployeeInput {
  id: string;
  full_name?: string;
  email?: string;
  team_id?: string | null;
  role?: "employee" | "team_lead" | "hr" | "admin";
  join_date?: string;
  is_active?: boolean;
  allowances?: { casual: number; sick: number; annual: number };
}

export async function updateEmployeeAction(
  input: UpdateEmployeeInput,
): Promise<ActionResult> {
  const auth = await requireHrActor();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("employees")
    .select(
      "id, full_name, email, team_id, role, join_date, is_active, leave_allowances",
    )
    .eq("id", input.id)
    .maybeSingle();
  if (!before) return { ok: false, error: "Employee not found" };

  const patch: Record<string, unknown> = {};
  if (input.full_name !== undefined) patch.full_name = input.full_name.trim();
  if (input.email !== undefined) patch.email = input.email.trim().toLowerCase();
  if (input.team_id !== undefined) patch.team_id = input.team_id;
  if (input.role !== undefined) patch.role = input.role;
  if (input.join_date !== undefined) patch.join_date = input.join_date;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (input.allowances !== undefined)
    patch.leave_allowances = input.allowances;

  const { error } = await admin
    .from("employees")
    .update(patch)
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  const action =
    input.is_active === false ? "employee_deactivated" : "employee_updated";

  await admin.from("audit_log").insert({
    actor_id: auth.actorId,
    action,
    target_type: "employee",
    target_id: input.id,
    details: { before, patch },
  });

  bumpAdminPaths();
  return { ok: true };
}

export async function deactivateEmployeeAction(
  id: string,
): Promise<ActionResult> {
  return updateEmployeeAction({ id, is_active: false });
}

export async function reactivateEmployeeAction(
  id: string,
): Promise<ActionResult> {
  return updateEmployeeAction({ id, is_active: true });
}

export interface CreateTeamInput {
  name: string;
  lead_id: string | null;
}

export async function createTeamAction(
  input: CreateTeamInput,
): Promise<ActionResult & { teamId?: string }> {
  const auth = await requireHrActor();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("teams")
    .insert({ name: input.name.trim(), lead_id: input.lead_id })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_log").insert({
    actor_id: auth.actorId,
    action: "team_created",
    target_type: "team",
    target_id: data.id,
    details: { name: input.name, lead_id: input.lead_id },
  });

  bumpAdminPaths();
  return { ok: true, teamId: data.id };
}

export async function setTeamLeadAction(input: {
  teamId: string;
  leadId: string | null;
}): Promise<ActionResult> {
  const auth = await requireHrActor();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("teams")
    .select("id, name, lead_id")
    .eq("id", input.teamId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Team not found" };

  // If setting a lead, verify they're on this team and active.
  if (input.leadId) {
    const { data: lead } = await admin
      .from("employees")
      .select("id, team_id, is_active, role")
      .eq("id", input.leadId)
      .maybeSingle();
    if (!lead) return { ok: false, error: "Lead not found" };
    if (!lead.is_active) return { ok: false, error: "Lead is inactive" };
    if (lead.team_id !== input.teamId) {
      return { ok: false, error: "Lead must be on this team" };
    }
  }

  const { error } = await admin
    .from("teams")
    .update({ lead_id: input.leadId })
    .eq("id", input.teamId);
  if (error) return { ok: false, error: error.message };

  // Promote / demote the role on the lead row.
  if (input.leadId) {
    await admin
      .from("employees")
      .update({ role: "team_lead" })
      .eq("id", input.leadId)
      .neq("role", "hr")
      .neq("role", "admin");
  }
  if (before.lead_id && before.lead_id !== input.leadId) {
    await admin
      .from("employees")
      .update({ role: "employee" })
      .eq("id", before.lead_id)
      .eq("role", "team_lead");
  }

  await admin.from("audit_log").insert({
    actor_id: auth.actorId,
    action: "team_lead_set",
    target_type: "team",
    target_id: input.teamId,
    details: { before_lead: before.lead_id, after_lead: input.leadId },
  });

  bumpAdminPaths();
  return { ok: true };
}

export async function deleteTeamAction(teamId: string): Promise<ActionResult> {
  const auth = await requireHrActor();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const { count } = await admin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: "Team still has employees — reassign them before deleting",
    };
  }

  const { error } = await admin.from("teams").delete().eq("id", teamId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_log").insert({
    actor_id: auth.actorId,
    action: "team_deleted",
    target_type: "team",
    target_id: teamId,
    details: {},
  });

  bumpAdminPaths();
  return { ok: true };
}
