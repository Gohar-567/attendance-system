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

  // Link the auth user to an employees row by email.
  // Slack OIDC supplies: email, name, sub (the Slack user ID), picture.
  const user = data.user;
  const meta = user.user_metadata ?? {};
  const email = user.email ?? meta.email;
  const fullName =
    meta.full_name ?? meta.name ?? meta.preferred_username ?? email ?? "Unknown";
  const slackUserId =
    meta.provider_id ?? meta.sub ?? user.app_metadata?.provider_id ?? null;

  if (email) {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("employees")
      .select("id, slack_user_id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      // Backfill slack_user_id on first login if missing.
      if (!existing.slack_user_id && slackUserId) {
        await admin
          .from("employees")
          .update({ slack_user_id: slackUserId })
          .eq("id", existing.id);
      }
    } else {
      // First-time login: create a row, flag for HR to review team/role.
      await admin.from("employees").insert({
        id: user.id,
        full_name: fullName,
        email,
        slack_user_id: slackUserId,
        join_date: new Date().toISOString().slice(0, 10),
      });
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
