import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/env";
import { slackClient } from "@/lib/slack/client";
import { todayISO } from "@/lib/date";
import { buildNudgeBlocks } from "@/lib/cron/nudge";

export const runtime = "nodejs";

/**
 * 09:30 AM PKT (= 04:30 UTC) Mon–Fri — DM each opted-in employee who
 * hasn't logged today's attendance yet. Schedule already excludes
 * weekends; we additionally check the holidays table so a manual run
 * (or a holiday that lands on a weekday) doesn't spam the team.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const today = todayISO();
  const admin = createAdminClient();

  // Public holiday today → skip entirely.
  const { data: hol } = await admin
    .from("holidays")
    .select("name")
    .eq("date", today)
    .maybeSingle();
  if (hol) {
    return NextResponse.json({
      ok: true,
      skipped_reason: "holiday",
      holiday: hol.name,
      sent: 0,
    });
  }

  const appUrl = getAppUrl();

  const [empRes, todayLogs] = await Promise.all([
    admin
      .from("employees")
      .select("id, full_name, slack_user_id, nudge_enabled")
      .eq("is_active", true)
      .eq("nudge_enabled", true)
      .not("slack_user_id", "is", null),
    admin
      .from("attendance_logs")
      .select("employee_id")
      .eq("date", today),
  ]);

  type Emp = {
    id: string;
    full_name: string;
    slack_user_id: string | null;
    nudge_enabled: boolean;
  };
  const employees = (empRes.data ?? []) as Emp[];
  const alreadyLogged = new Set(
    (todayLogs.data ?? []).map((r) => r.employee_id),
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const e of employees) {
    if (!e.slack_user_id) {
      skipped++;
      continue;
    }
    if (alreadyLogged.has(e.id)) {
      skipped++;
      continue;
    }
    const blocks = buildNudgeBlocks({
      fullName: e.full_name,
      date: today,
      appUrl,
    });
    try {
      await slackClient().chat.postMessage({
        channel: e.slack_user_id,
        text: `Morning ${e.full_name} — quick attendance log?`,
        blocks: blocks as never,
      });
      sent++;
    } catch (err) {
      failed++;
      console.warn("daily-nudge DM failed", e.id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    eligible: employees.length,
    sent,
    skipped,
    failed,
  });
}
