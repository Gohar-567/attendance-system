import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMonthlySummary } from "@/lib/admin/monthly-report";
import { firstOfMonthISO, lastOfMonthISO } from "@/lib/date";
import { formatInstantTime } from "@/lib/time";

export const runtime = "nodejs";

/**
 * GET /api/export?month=YYYY-MM&team=<team_id|all>
 *
 * HR/admin only. Returns an .xlsx with two sheets:
 *   - Summary: per-employee monthly counts (mirrors /admin/report)
 *   - Details: every attendance_logs row in the month
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: actor } = await admin
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (!actor || (actor.role !== "hr" && actor.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const teamParam = url.searchParams.get("team");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "month must be YYYY-MM" },
      { status: 400 },
    );
  }
  const teamId = teamParam && teamParam !== "all" ? teamParam : null;
  const monthISO = `${month}-01`;
  const fromISO = firstOfMonthISO(monthISO);
  const toISO = lastOfMonthISO(monthISO);

  const { rows: summary } = await fetchMonthlySummary({
    monthISO,
    teamId,
  });

  // Pull the full details for sheet 2.
  const employeeIds = summary.map((s) => s.employee_id);
  const { data: detailRows } = employeeIds.length
    ? await admin
        .from("attendance_logs")
        .select(
          `date, type, half, reason, source, status,
           checkin_time, checkout_time, total_hours,
           employee:employees!employee_id ( id, full_name, team:teams!team_id ( id, name ) )`,
        )
        .in("employee_id", employeeIds)
        .gte("date", fromISO)
        .lte("date", toISO)
        .order("date", { ascending: true })
    : { data: [] };

  type DetailRow = {
    date: string;
    type: string;
    half: string;
    reason: string | null;
    source: string;
    status: string;
    checkin_time: string | null;
    checkout_time: string | null;
    total_hours: number | null;
    employee: {
      id: string;
      full_name: string;
      team: { id: string; name: string } | null;
    } | null;
  };
  const details = (detailRows ?? []) as unknown as DetailRow[];

  // Sessions for the month, grouped by employee + business day, so the
  // Details sheet can list each day's session times comma-separated.
  const { data: sessionRows } = employeeIds.length
    ? await admin
        .from("work_sessions")
        .select("employee_id, session_date, started_at, ended_at")
        .in("employee_id", employeeIds)
        .gte("session_date", fromISO)
        .lte("session_date", toISO)
        .order("started_at", { ascending: true })
    : { data: [] };
  type SessRow = {
    employee_id: string;
    session_date: string;
    started_at: string;
    ended_at: string | null;
  };
  const sessionsByKey = new Map<string, string[]>();
  for (const s of (sessionRows ?? []) as SessRow[]) {
    const key = `${s.employee_id}|${s.session_date}`;
    const label = `${formatInstantTime(s.started_at)}-${
      s.ended_at ? formatInstantTime(s.ended_at) : "open"
    }`;
    const list = sessionsByKey.get(key) ?? [];
    list.push(label);
    sessionsByKey.set(key, list);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Attendance system";
  workbook.created = new Date();

  // ---- Summary sheet ----
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Employee", key: "employee", width: 28 },
    { header: "Team", key: "team", width: 18 },
    { header: "Present", key: "present", width: 10 },
    { header: "WFH", key: "wfh", width: 10 },
    { header: "Half", key: "half", width: 10 },
    { header: "Casual", key: "casual", width: 10 },
    { header: "Sick", key: "sick", width: 10 },
    { header: "Annual", key: "annual", width: 10 },
    { header: "Avg hrs/day", key: "avg_hours", width: 14 },
    { header: "Sessions/day", key: "sessions_day", width: 14 },
    { header: "Total hours", key: "total_hours", width: 14 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of summary) {
    summarySheet.addRow({
      employee: r.full_name,
      team: r.team_name ?? "",
      present: r.present,
      wfh: r.wfh,
      half: r.half,
      casual: r.casual,
      sick: r.sick,
      annual: r.annual,
      avg_hours:
        r.avg_hours_per_day == null
          ? ""
          : Math.round(r.avg_hours_per_day * 10) / 10,
      sessions_day:
        r.sessions_per_day == null
          ? ""
          : Math.round(r.sessions_per_day * 10) / 10,
      total_hours:
        r.total_hours > 0 ? Math.round(r.total_hours * 10) / 10 : "",
    });
  }

  if (summary.length > 0) {
    const totals = summary.reduce(
      (acc, r) => ({
        present: acc.present + r.present,
        wfh: acc.wfh + r.wfh,
        half: acc.half + r.half,
        casual: acc.casual + r.casual,
        sick: acc.sick + r.sick,
        annual: acc.annual + r.annual,
        total_hours: acc.total_hours + r.total_hours,
        hours_days: acc.hours_days + r.hours_days,
      }),
      {
        present: 0,
        wfh: 0,
        half: 0,
        casual: 0,
        sick: 0,
        annual: 0,
        total_hours: 0,
        hours_days: 0,
      },
    );
    const totalRow = summarySheet.addRow({
      employee: "Total",
      team: `${summary.length} employees`,
      present: totals.present,
      wfh: totals.wfh,
      half: totals.half,
      casual: totals.casual,
      sick: totals.sick,
      annual: totals.annual,
      avg_hours:
        totals.hours_days > 0
          ? Math.round((totals.total_hours / totals.hours_days) * 10) / 10
          : "",
      sessions_day: "",
      total_hours:
        totals.total_hours > 0
          ? Math.round(totals.total_hours * 10) / 10
          : "",
    });
    totalRow.font = { bold: true };
  }

  // ---- Details sheet ----
  const detailsSheet = workbook.addWorksheet("Details");
  detailsSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Employee", key: "employee", width: 28 },
    { header: "Team", key: "team", width: 18 },
    { header: "Type", key: "type", width: 14 },
    { header: "Half", key: "half", width: 12 },
    { header: "Sessions", key: "sessions", width: 36 },
    { header: "Hours", key: "hours", width: 10 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Source", key: "source", width: 14 },
    { header: "Status", key: "status", width: 14 },
  ];
  detailsSheet.getRow(1).font = { bold: true };
  detailsSheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const d of details) {
    detailsSheet.addRow({
      date: d.date,
      employee: d.employee?.full_name ?? "",
      team: d.employee?.team?.name ?? "",
      type: d.type,
      half: d.half,
      sessions:
        sessionsByKey.get(`${d.employee?.id}|${d.date}`)?.join(", ") ?? "",
      hours:
        d.total_hours == null
          ? ""
          : Math.round(Number(d.total_hours) * 10) / 10,
      reason: d.reason ?? "",
      source: d.source,
      status: d.status,
    });
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const filename = `attendance-${month}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
