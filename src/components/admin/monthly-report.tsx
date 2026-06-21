"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type {
  MonthlyKpis,
  MonthlyReportRow,
} from "@/lib/admin/monthly-report";

interface MonthlyReportProps {
  monthISO: string;
  teams: { id: string; name: string }[];
  activeTeamId: string | null;
  rows: MonthlyReportRow[];
  kpis: MonthlyKpis;
}

export function MonthlyReport({
  monthISO,
  teams,
  activeTeamId,
  rows,
  kpis,
}: MonthlyReportProps) {
  const router = useRouter();
  const monthValue = monthISO.slice(0, 7);

  function navigate(next: { month?: string; team?: string }) {
    const params = new URLSearchParams();
    params.set("month", next.month ?? monthValue);
    params.set("team", next.team ?? activeTeamId ?? "all");
    router.replace(`/admin/report?${params.toString()}`);
  }

  const totals = useMemo(() => {
    const acc = {
      present: 0,
      wfh: 0,
      half: 0,
      casual: 0,
      sick: 0,
      annual: 0,
      total_hours: 0,
      hours_days: 0,
      total_sessions: 0,
    };
    for (const r of rows) {
      acc.present += r.present;
      acc.wfh += r.wfh;
      acc.half += r.half;
      acc.casual += r.casual;
      acc.sick += r.sick;
      acc.annual += r.annual;
      acc.total_hours += r.total_hours;
      acc.hours_days += r.hours_days;
      acc.total_sessions += r.total_sessions;
    }
    return acc;
  }, [rows]);

  const exportHref = `/api/export?month=${monthValue}&team=${activeTeamId ?? "all"}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="month">Month</Label>
            <Input
              id="month"
              type="month"
              value={monthValue}
              onChange={(e) => navigate({ month: e.target.value })}
              className="w-40"
            />
          </div>
        </div>
        <Button variant="outline" asChild>
          <a href={exportHref}>Export Excel</a>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip
          label={`All (${rows.length})`}
          active={!activeTeamId}
          onClick={() => navigate({ team: "all" })}
        />
        {teams.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            active={activeTeamId === t.id}
            onClick={() => navigate({ team: t.id })}
          />
        ))}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium text-right">Present</th>
                <th className="px-3 py-2 font-medium text-right">WFH</th>
                <th className="px-3 py-2 font-medium text-right">Half</th>
                <th className="px-3 py-2 font-medium text-right">Casual</th>
                <th className="px-3 py-2 font-medium text-right">Sick</th>
                <th className="px-3 py-2 font-medium text-right">Annual</th>
                <th className="px-3 py-2 font-medium text-right">Avg hrs/day</th>
                <th className="px-3 py-2 font-medium text-right">Sess/day</th>
                <th className="px-3 py-2 font-medium text-right">Total hrs</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-3 py-12 text-center text-sm text-muted-foreground"
                  >
                    No active employees in this filter.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.employee_id} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.full_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.team_name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.present}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        r.wfh > 5 &&
                          "font-bold text-blue-700 dark:text-blue-300",
                      )}
                    >
                      {r.wfh}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        r.half > 3 &&
                          "font-bold text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {r.half}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.casual}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.sick}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        r.annual > 4 &&
                          "font-bold text-red-700 dark:text-red-300",
                      )}
                    >
                      {r.annual}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.avg_hours_per_day == null
                        ? "—"
                        : (Math.round(r.avg_hours_per_day * 10) / 10).toFixed(
                            1,
                          )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.sessions_per_day == null
                        ? "—"
                        : (Math.round(r.sessions_per_day * 10) / 10).toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.total_hours > 0
                        ? (Math.round(r.total_hours * 10) / 10).toFixed(1)
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
              {rows.length > 0 && (
                <tr className="border-t bg-muted/20 font-semibold">
                  <td className="px-3 py-2">Team total</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {rows.length} employees
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.present}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.wfh}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.half}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.casual}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.sick}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.annual}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.hours_days > 0
                      ? (
                          Math.round((totals.total_hours / totals.hours_days) * 10) /
                          10
                        ).toFixed(1)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.total_sessions}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.total_hours > 0
                      ? (Math.round(totals.total_hours * 10) / 10).toFixed(1)
                      : "—"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <KpiCard
          label="Avg attendance rate"
          value={`${(kpis.avg_attendance_rate * 100).toFixed(1)}%`}
          sub={`${kpis.working_days} working days`}
        />
        <KpiCard
          label="WFH ratio"
          value={`${(kpis.wfh_ratio * 100).toFixed(1)}%`}
          sub="of all worked days"
        />
        <KpiCard
          label="Total leaves taken"
          value={`${kpis.total_leaves}`}
          sub="incl. half-days"
        />
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
