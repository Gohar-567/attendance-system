import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMonthlySummary } from "@/lib/admin/monthly-report";
import { firstOfMonthISO, lastOfMonthISO } from "@/lib/date";

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
      }),
      { present: 0, wfh: 0, half: 0, casual: 0, sick: 0, annual: 0 },
    );
    const totalRow = summarySheet.addRow({
      employee: "Total",
      team: `${summary.length} employees`,
      ...totals,
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
