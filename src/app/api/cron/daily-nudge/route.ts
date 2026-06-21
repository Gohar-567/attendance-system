import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/env";
import { slackClient } from "@/lib/slack/client";
import { todayISO } from "@/lib/date";
import { hoursSince, MAX_SESSION_HOURS } from "@/lib/business-day";
import { cronSkipReason } from "@/lib/cron/guards";
import { buildNudgeBlocks } from "@/lib/cron/nudge";

export const runtime = "nodejs";

/**
 * 11:00 AM PKT (= 06:00 UTC) Mon–Fri — DM each opted-in employee who
 * hasn't logged today's attendance yet. Phase 9 (9E): explicitly skip
 * weekends + holidays (in case of a manual run), and skip anyone with an
 * open session started ≥ 16h ago (they're already in trouble — the
 * checkout reminder owns that; don't double up).
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

  const skip = await cronSkipReason(admin, today);
  if (skip) {
    return NextResponse.json({ ok: true, skipped_reason: skip, sent: 0 });
  }

  const appUrl = getAppUrl();

  const [empRes, todayLogs, openSessions] = await Promise.all([
    admin
      .from("employees")
      .select("id, full_name, slack_user_id, nudge_enabled")
      .eq("is_active", true)
      .eq("nudge_enabled", true)
      .not("slack_user_id", "is", null),
    admin.from("attendance_logs").select("employee_id").eq("date", today),
    admin
      .from("work_sessions")
      .select("employee_id, started_at")
      .is("ended_at", null),
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
  // Employees with a long-running open session — skip the morning nudge.
  const stuckOpen = new Set(
    ((openSessions.data ?? []) as { employee_id: string; started_at: string }[])
      .filter((s) => hoursSince(s.started_at) >= MAX_SESSION_HOURS)
      .map((s) => s.employee_id),
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const e of employees) {
    if (!e.slack_user_id) {
      skipped++;
      continue;
    }
    if (alreadyLogged.has(e.id) || stuckOpen.has(e.id)) {
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
