import { createAdminClient } from "@/lib/supabase/admin";
import { slackClient } from "./client";

export interface ResolvedEmployee {
  id: string;
  full_name: string;
  email: string;
  team_id: string | null;
  role: string;
  slack_user_id: string | null;
}

/**
 * Resolve a Slack user_id to an employees row.
 *
 * Lookup order:
 *   1. employees.slack_user_id = <slackUserId>
 *   2. users.info(slackUserId) → email → employees.email = <email>;
 *      backfill slack_user_id on hit
 *   3. null (caller should DM the user "you're not in the system")
 */
export async function resolveEmployeeBySlackId(
  slackUserId: string,
): Promise<ResolvedEmployee | null> {
  const admin = createAdminClient();

  const direct = await admin
    .from("employees")
    .select("id, full_name, email, team_id, role, slack_user_id")
    .eq("slack_user_id", slackUserId)
    .maybeSingle();

  if (direct.data) return direct.data as ResolvedEmployee;

  // Fall back to email lookup via Slack profile.
  let email: string | null = null;
  try {
    const info = await slackClient().users.info({ user: slackUserId });
    email = info.user?.profile?.email ?? null;
  } catch {
    return null;
  }
  if (!email) return null;

  const byEmail = await admin
    .from("employees")
    .select("id, full_name, email, team_id, role, slack_user_id")
    .eq("email", email)
    .maybeSingle();

  if (!byEmail.data) return null;

  // Backfill the Slack user id so subsequent lookups skip the API call.
  if (!byEmail.data.slack_user_id) {
    await admin
      .from("employees")
      .update({ slack_user_id: slackUserId })
      .eq("id", byEmail.data.id);
    byEmail.data.slack_user_id = slackUserId;
  }

  return byEmail.data as ResolvedEmployee;
}

/**
 * DM a Slack user. Slack auto-opens the IM channel for bots that hold
 * im:write + chat:write, so we can post directly with the user id.
 */
export async function dmSlackUser(slackUserId: string, text: string) {
  await slackClient().chat.postMessage({ channel: slackUserId, text });
}

export async function notifyUnknownUser(slackUserId: string) {
  const hrEmail = process.env.HR_NOTIFY_EMAIL || "your HR contact";
  await dmSlackUser(
    slackUserId,
    `:wave: You're not in the attendance system yet. Ask HR to add you — *${hrEmail}*. Once they do, post in #attendance again and I'll log it.`,
  );
}
