import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { slackClient } from "@/lib/slack/client";
import { todayISO } from "@/lib/date";
import { formatInstantTime } from "@/lib/time";
import { hoursSince, MAX_SESSION_HOURS } from "@/lib/business-day";
import { cronSkipReason } from "@/lib/cron/guards";

export const runtime = "nodejs";

/**
 * 9 PM PKT (= 16:00 UTC) Mon–Fri.
 *
 * DM every active employee who still has an OPEN work session — they
 * checked in but never checked out. Phase 9 (9E):
 *   - Skip weekends + holidays (manual-run guard).
 *   - Only ping sessions open longer than 4h (don't nag someone who just
 *     started) and shorter than 16h (≥16h is already broken — surfaced
 *     elsewhere; don't add noise).
 *   Per-employee try/catch so one bad DM doesn't kill the whole run.
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

  const skip = await cronSkipReason(admin, date);
  if (skip) {
    return NextResponse.json({ ok: true, skipped_reason: skip, sent: 0 });
  }

  // Every open session, joined to its employee for the Slack id + name.
  const { data: rows } = await admin
    .from("work_sessions")
    .select(
      `id, employee_id, started_at,
       employee:employees!employee_id ( id, full_name, slack_user_id, is_active )`,
    )
    .is("ended_at", null);

  type Row = {
    id: string;
    employee_id: string;
    started_at: string;
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
    const age = hoursSince(r.started_at);
    if (age < 4 || age >= MAX_SESSION_HOURS) {
      skipped++;
      continue;
    }
    const checkinPretty = formatInstantTime(r.started_at);
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
