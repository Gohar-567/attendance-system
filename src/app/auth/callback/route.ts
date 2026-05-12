import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/me";
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error?.message ?? "auth_failed")}`,
    );
  }

  // Slack OIDC supplies email, name, sub (the Slack user ID), picture.
  const user = data.user;
  const meta = user.user_metadata ?? {};
  const email = user.email ?? meta.email;
  const slackUserId =
    meta.provider_id ?? meta.sub ?? user.app_metadata?.provider_id ?? null;

  // Link the auth user to an employees row by email. The RLS model in
  // §8 of the manifest assumes employees.id == auth.users.id, so this
  // is the step that makes RLS work for every other page.
  //
  // Four cases:
  //   1. No employees row with this email → the user was never added.
  //      Don't auto-create. Fall through to the redirect; downstream
  //      pages (/me, /) render the "Your account isn't linked yet —
  //      ask HR" shell. HR must add them in /admin/employees first.
  //   2. Row exists, id already == auth.users.id → nothing to do.
  //   3. Row exists, id differs from auth.users.id → HR seeded the
  //      row with a random gen_random_uuid before the user signed in
  //      for the first time. UPDATE id to auth.users.id so RLS works.
  //      All other columns (role, team_id, leave_allowances, etc.)
  //      ride along untouched.
  //   4. Row exists, slack_user_id is NULL → backfill it from the
  //      OAuth identity so the Slack bot can DM this user.
  //
  // Cases 3 and 4 commonly happen together on the very first login
  // and are combined into a single UPDATE.
  if (email) {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("employees")
      .select("id, slack_user_id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      const patch: { id?: string; slack_user_id?: string } = {};
      if (existing.id !== user.id) patch.id = user.id;
      if (!existing.slack_user_id && slackUserId) {
        patch.slack_user_id = slackUserId;
      }

      if (Object.keys(patch).length > 0) {
        const { error: updateErr } = await admin
          .from("employees")
          .update(patch)
          .eq("id", existing.id);

        if (updateErr) {
          // The id realignment can fail with a foreign-key violation if
          // attendance_logs, leave_requests, audit_log, or teams.lead_id
          // already reference the old id (none of those FKs cascade on
          // UPDATE in the schema). That should only happen if the row
          // was seeded *and* given activity before the user logged in,
          // which is rare — but we don't want to block the sign-in.
          // Log and fall through; the user lands on the unlinked shell
          // and admin can reconcile in the SQL Editor.
          console.warn(
            "auth callback: failed to align employees.id with auth.uid",
            { auth_uid: user.id, employees_id: existing.id, error: updateErr },
          );

          // Best effort: still try the slack_user_id backfill alone so a
          // future Slack DM at least reaches them.
          if (patch.slack_user_id) {
            await admin
              .from("employees")
              .update({ slack_user_id: patch.slack_user_id })
              .eq("id", existing.id);
          }
        }
      }
    }
    // Case 1 (no row) → no DB writes; fall through to the redirect.
  }

  return NextResponse.redirect(`${origin}${next}`);
}
