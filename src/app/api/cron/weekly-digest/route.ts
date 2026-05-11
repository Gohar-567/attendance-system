import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { slackClient } from "@/lib/slack/client";
import { todayISO } from "@/lib/date";
import { fetchHolidaySet } from "@/lib/leave/holidays";
import {
  buildDigestBlocks,
  dayGlyph,
  lastSundayISO,
  weekDays,
} from "@/lib/cron/digest";

export const runtime = "nodejs";

/**
 * Sunday 7 PM PKT (= 14:00 UTC Sun) — DM each opted-in employee a recap of
 * the just-finished week + their remaining balances. Skips employees with
 * digest_enabled=false, no slack_user_id, or is_active=false.
 *
 * Idempotent in practice: re-running the same day produces the same DM
 * content. Per-employee try/catch keeps one bad DM from killing the run.
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
  const today = todayISO();
  const sun = lastSundayISO(today);
  const days = weekDays(sun);
  const weekStart = days[0];
  const weekEnd = days[6];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const [empRes, logRes, balRes, holidaySet] = await Promise.all([
    admin
      .from("employees")
      .select(
        "id, full_name, slack_user_id, join_date, digest_enabled",
      )
      .eq("is_active", true)
      .eq("digest_enabled", true)
      .not("slack_user_id", "is", null),
    admin
      .from("attendance_logs")
      .select("employee_id, date, type, half")
      .gte("date", weekStart)
      .lte("date", weekEnd),
    admin
      .from("v_employee_balances")
      .select(
        "employee_id, casual_allowance, casual_used, sick_allowance, sick_used, annual_allowance, annual_used",
      ),
    fetchHolidaySet(admin, weekStart, weekEnd),
  ]);

  type Emp = {
    id: string;
    full_name: string;
    slack_user_id: string | null;
    join_date: string;
    digest_enabled: boolean;
  };
  type Log = {
    employee_id: string;
    date: string;
    type: string;
    half: string;
  };
  type Bal = {
    employee_id: string;
    casual_allowance: number;
    casual_used: number;
    sick_allowance: number;
    sick_used: number;
    annual_allowance: number;
    annual_used: number;
  };

  const employees = (empRes.data ?? []) as Emp[];
  const logs = (logRes.data ?? []) as Log[];
  const balances = (balRes.data ?? []) as Bal[];

  // Group logs and balances by employee.
  const logsByEmp = new Map<string, Map<string, Log>>();
  for (const l of logs) {
    if (!logsByEmp.has(l.employee_id)) logsByEmp.set(l.employee_id, new Map());
    logsByEmp.get(l.employee_id)!.set(l.date, l);
  }
  const balByEmp = new Map<string, Bal>();
  for (const b of balances) balByEmp.set(b.employee_id, b);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const e of employees) {
    if (!e.slack_user_id) {
      skipped++;
      continue;
    }
    const myLogs = logsByEmp.get(e.id) ?? new Map();
    const squares: string[] = [];
    let daysAtOffice = 0;
    let daysWfh = 0;
    let halfDays = 0;

    for (const iso of days) {
      const log = myLogs.get(iso) ?? null;
      const isHoliday = holidaySet.has(iso);
      squares.push(dayGlyph({ iso, joinDateISO: e.join_date, log, isHoliday }));
      if (log) {
        if (log.type === "present") daysAtOffice++;
        else if (log.type === "wfh" || log.type === "ewd") daysWfh++;
        else if (log.type === "half_leave") halfDays++;
      }
    }

    const bal = balByEmp.get(e.id);
    const blocks = buildDigestBlocks({
      fullName: e.full_name,
      weekStartISO: weekStart,
      weekEndISO: weekEnd,
      joinDateISO: e.join_date,
      squares,
      daysAtOffice,
      daysWfh,
      halfDays,
      casualLeft: bal ? bal.casual_allowance - bal.casual_used : 0,
      sickLeft: bal ? bal.sick_allowance - bal.sick_used : 0,
      annualLeft: bal ? bal.annual_allowance - bal.annual_used : 0,
      appUrl,
    });

    try {
      await slackClient().chat.postMessage({
        channel: e.slack_user_id,
        text: `Your week in review (${weekStart} → ${weekEnd})`,
        blocks: blocks as never,
      });
      sent++;
    } catch (err) {
      failed++;
      console.warn("weekly-digest DM failed", e.id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    week: { start: weekStart, end: weekEnd },
    eligible: employees.length,
    sent,
    skipped,
    failed,
  });
}
