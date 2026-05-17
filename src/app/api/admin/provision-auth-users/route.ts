import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/admin/provision-auth-users
 *
 * One-time bulk-provision endpoint. For every row in `employees` whose
 * email isn't already in `auth.users`, create the auth user
 * (`email_confirm: true` so no signup email goes out) and re-link
 * `employees.id` to the new `auth.users.id` so RLS keeps working.
 *
 * Why we need this: employees seeded directly via SQL never went through
 * Supabase Auth, so `auth.users` is empty for them. That means magic
 * links fail with "Signups not allowed for otp" (we deliberately set
 * shouldCreateUser=false to prevent self-signup), and the RLS policies
 * that compare `auth.uid()` to `employees.id` would also drift on first
 * login.
 *
 * Bearer ${CRON_SECRET} required — same gate as the cron endpoints, so
 * this can't be triggered casually.
 *
 * Response:
 *   {
 *     provisioned: number,            // auth users created + employees relinked
 *     skipped:     number,            // employees already had an auth user
 *     failed:      [{ email, error }] // any per-row errors (FK violation, etc.)
 *   }
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1. Pull every employee row + every existing auth user. We're a tiny
  //    org; listUsers in a single page is fine (perPage=1000 ceiling).
  const [empRes, authRes] = await Promise.all([
    admin
      .from("employees")
      .select("id, email, full_name")
      .order("email"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (empRes.error) {
    return NextResponse.json(
      { error: `employees query failed: ${empRes.error.message}` },
      { status: 500 },
    );
  }
  if (authRes.error) {
    return NextResponse.json(
      { error: `auth.admin.listUsers failed: ${authRes.error.message}` },
      { status: 500 },
    );
  }

  type Emp = { id: string; email: string; full_name: string };
  const employees = (empRes.data ?? []) as Emp[];

  const authByEmail = new Map<string, string>();
  for (const u of authRes.data.users) {
    if (u.email) authByEmail.set(u.email.toLowerCase(), u.id);
  }

  let provisioned = 0;
  let skipped = 0;
  const failed: { email: string; error: string }[] = [];

  for (const emp of employees) {
    const email = emp.email?.toLowerCase();
    if (!email) {
      failed.push({ email: emp.email ?? "(null)", error: "email missing" });
      continue;
    }

    if (authByEmail.has(email)) {
      // Already exists. We don't try to realign the id here — that's the
      // OAuth callback's job on first login, and doing it here could
      // disrupt working employees.
      skipped++;
      continue;
    }

    // 2. Create the auth user. email_confirm:true → no confirmation
    //    email is sent. user_metadata is just informational.
    let newAuthId: string;
    try {
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { full_name: emp.full_name },
        });
      if (createErr || !created?.user) {
        failed.push({
          email,
          error: createErr?.message ?? "createUser returned no user",
        });
        continue;
      }
      newAuthId = created.user.id;
    } catch (err) {
      failed.push({ email, error: String(err) });
      continue;
    }

    // 3. Re-link employees.id to the new auth user id. The schema has FK
    //    references from attendance_logs / leave_requests / teams.lead_id
    //    / audit_log.actor_id without ON UPDATE CASCADE, so this can fail
    //    if the employee already has activity. When it does we delete the
    //    orphan auth user we just created so a retry can succeed.
    if (emp.id !== newAuthId) {
      const { error: updateErr } = await admin
        .from("employees")
        .update({ id: newAuthId })
        .eq("id", emp.id);

      if (updateErr) {
        await admin.auth.admin
          .deleteUser(newAuthId)
          .catch((cleanupErr) =>
            console.warn(
              "provision-auth-users: orphan cleanup failed",
              email,
              cleanupErr,
            ),
          );
        failed.push({
          email,
          error: `employees.id update failed: ${updateErr.message}`,
        });
        continue;
      }
    }

    // 4. Audit row. actor_id is null because no human triggered this —
    //    this is a system migration. Use the *new* id as target_id (the
    //    one that now exists in employees AND auth.users).
    await admin.from("audit_log").insert({
      actor_id: null,
      action: "auth_user_provisioned",
      target_type: "employee",
      target_id: newAuthId,
      details: {
        email,
        old_employee_id: emp.id,
        new_employee_id: newAuthId,
        relinked: emp.id !== newAuthId,
      },
    });

    provisioned++;
  }

  return NextResponse.json({
    provisioned,
    skipped,
    failed,
  });
}
