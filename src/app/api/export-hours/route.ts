import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchHoursOverview, resolveRange } from "@/lib/admin/hours";

export const runtime = "nodejs";

/**
 * GET /api/export-hours?range=...&from=...&to=...&team=...
 * HR/admin only. Excel with two sheets:
 *   Summary — per-employee totals matching the on-screen table, plus
 *             range-scoped hours/days columns
 *   Details — every attendance_logs row in the chosen range with hours data
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
  const teamParam = url.searchParams.get("team");
  const range = resolveRange({
    range: url.searchParams.get("range"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  const teamId = teamParam && teamParam !== "all" ? teamParam : null;

  const { rows } = await fetchHoursOverview({
    teamId,
    fromISO: range.fromISO,
    toISO: range.toISO,
  });
  const employeeIds = rows.map((r) => r.employee_id);

  const { data: detailRows } = employeeIds.length
    ? await admin
        .from("attendance_logs")
        .select(
          `date, type, half, checkin_time, checkout_time, total_hours,
           employee:employees!employee_id ( id, full_name, team:teams!team_id ( id, name ) )`,
        )
        .in("employee_id", employeeIds)
        .gte("date", range.fromISO)
        .lte("date", range.toISO)
        .not("total_hours", "is", null)
        .order("date", { ascending: true })
    : { data: [] };

  type DetailRow = {
    date: string;
    type: string;
    half: string;
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

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Attendance system";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Employee", key: "employee", width: 28 },
    { header: "Team", key: "team", width: 18 },
    { header: "Hours today", key: "hours_today", width: 14 },
    { header: "Hours week", key: "hours_week", width: 14 },
    { header: "Hours month", key: "hours_month", width: 14 },
    { header: "Avg/day month", key: "avg_day", width: 16 },
    { header: "Days worked month", key: "days_month", width: 18 },
    { header: "Hours in range", key: "hours_range", width: 16 },
    { header: "Days in range", key: "days_range", width: 14 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of rows) {
    summary.addRow({
      employee: r.full_name,
      team: r.team_name ?? "",
      hours_today: round1(r.hours_today),
      hours_week: round1(r.hours_week),
      hours_month: round1(r.hours_month),
      avg_day: round1(r.avg_hours_per_day),
      days_month: r.days_worked_month,
      hours_range: round1(r.hours_in_range),
      days_range: r.days_in_range,
    });
  }

  const detailsSheet = workbook.addWorksheet("Details");
  detailsSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Employee", key: "employee", width: 28 },
    { header: "Team", key: "team", width: 18 },
    { header: "Type", key: "type", width: 14 },
    { header: "Check-in", key: "checkin", width: 12 },
    { header: "Check-out", key: "checkout", width: 12 },
    { header: "Hours", key: "hours", width: 10 },
  ];
  detailsSheet.getRow(1).font = { bold: true };
  detailsSheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const d of details) {
    detailsSheet.addRow({
      date: d.date,
      employee: d.employee?.full_name ?? "",
      team: d.employee?.team?.name ?? "",
      type: d.type,
      checkin: d.checkin_time ?? "",
      checkout: d.checkout_time ?? "",
      hours: round1(d.total_hours),
    });
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const filename = `hours-${range.fromISO}-to-${range.toISO}.xlsx`;

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

function round1(v: number | null | undefined): number | string {
  if (v == null) return "";
  return Math.round(Number(v) * 10) / 10;
}
