import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { slackClient } from "@/lib/slack/client";
import { todayISO } from "@/lib/date";
import { formatTimeShort } from "@/lib/time";

export const runtime = "nodejs";

/**
 * 8 PM PKT (= 15:00 UTC) Mon–Fri.
 *
 * For every active employee with a Slack ID whose today's row has
 * checkin_time set but checkout_time still null AND the entry is a
 * working-type (present/wfh/ewd — not leave/sick/holiday/half), DM them
 * a gentle nudge. Per-employee try/catch so one bad DM doesn't kill the
 * whole run.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const date = todayISO();

  // Pull every row for today that needs a checkout. Join in the employee
  // for the Slack id + display name.
  const { data: rows } = await admin
    .from("attendance_logs")
    .select(
      `id, employee_id, checkin_time, checkout_time, type,
       employee:employees!employee_id ( id, full_name, slack_user_id, is_active )`,
    )
    .eq("date", date)
    .in("type", ["present", "wfh", "ewd"])
    .not("checkin_time", "is", null)
    .is("checkout_time", null);

  type Row = {
    id: string;
    employee_id: string;
    checkin_time: string;
    checkout_time: string | null;
    type: string;
    employee: {
      id: string;
      full_name: string;
      slack_user_id: string | null;
      is_active: boolean;
    } | null;
  };
  const candidates = (rows ?? []) as unknown as Row[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of candidates) {
    const emp = r.employee;
    if (!emp || !emp.is_active || !emp.slack_user_id) {
      skipped++;
      continue;
    }
    const checkinPretty = formatTimeShort(r.checkin_time);
    try {
      await slackClient().chat.postMessage({
        channel: emp.slack_user_id,
        text: `Did you forget to check out? You checked in at ${checkinPretty}.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:wave: *${emp.full_name}* — you checked in at *${checkinPretty}* but haven't checked out yet.\n\nReply with \`checkout\` to mark now, or edit your entry on the dashboard.`,
            },
          },
        ],
      });
      sent++;
    } catch (err) {
      failed++;
      console.warn("checkout-reminder DM failed", emp.id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    date,
    candidates: candidates.length,
    sent,
    skipped,
    failed,
  });
}
