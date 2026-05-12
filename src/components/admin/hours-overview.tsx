"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HoursRow, RangeKind } from "@/lib/admin/hours";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

interface HoursOverviewProps {
  rows: HoursRow[];
  teams: { id: string; name: string }[];
  activeTeamId: string | null;
  range: { kind: RangeKind; fromISO: string; toISO: string };
  sort: { key: string; dir: "asc" | "desc" };
}

const COLUMNS: { key: string; label: string; numeric?: boolean }[] = [
  { key: "full_name", label: "Name" },
  { key: "team_name", label: "Team" },
  { key: "hours_today", label: "Today", numeric: true },
  { key: "hours_week", label: "This week", numeric: true },
  { key: "hours_month", label: "This month", numeric: true },
  { key: "avg_hours_per_day", label: "Avg/day (month)", numeric: true },
  { key: "days_worked_month", label: "Days (month)", numeric: true },
];

export function HoursOverview({
  rows,
  teams,
  activeTeamId,
  range,
  sort,
}: HoursOverviewProps) {
  const router = useRouter();
  const params = useSearchParams();

  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`/admin/hours?${next.toString()}`);
  }

  const exportHref =
    `/api/export-hours?range=${range.kind}` +
    `&from=${range.fromISO}&to=${range.toISO}` +
    `&team=${activeTeamId ?? "all"}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Range</Label>
            <div className="flex gap-1">
              <RangeChip
                label="Last 7 days"
                active={range.kind === "last7"}
                onClick={() =>
                  navigate({ range: "last7", from: null, to: null })
                }
              />
              <RangeChip
                label="Last 30 days"
                active={range.kind === "last30"}
                onClick={() =>
                  navigate({ range: "last30", from: null, to: null })
                }
              />
              <RangeChip
                label="Custom"
                active={range.kind === "custom"}
                onClick={() =>
                  navigate({
                    range: "custom",
                    from: range.fromISO,
                    to: range.toISO,
                  })
                }
              />
            </div>
          </div>
          {range.kind === "custom" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="from" className="text-xs">
                  From
                </Label>
                <Input
                  id="from"
                  type="date"
                  className="w-40"
                  value={range.fromISO}
                  onChange={(e) =>
                    navigate({ range: "custom", from: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to" className="text-xs">
                  To
                </Label>
                <Input
                  id="to"
                  type="date"
                  className="w-40"
                  value={range.toISO}
                  onChange={(e) =>
                    navigate({ range: "custom", to: e.target.value })
                  }
                />
              </div>
            </>
          )}
        </div>
        <Button variant="outline" asChild>
          <a href={exportHref}>Export Excel</a>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <TeamChip
          active={!activeTeamId}
          onClick={() => navigate({ team: "all" })}
          label="All teams"
        />
        {teams.map((t) => (
          <TeamChip
            key={t.id}
            active={activeTeamId === t.id}
            onClick={() => navigate({ team: t.id })}
            label={t.name}
          />
        ))}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key;
                  const nextDir =
                    active && sort.dir === "asc" ? "desc" : "asc";
                  return (
                    <th
                      key={c.key}
                      className={cn(
                        "px-3 py-2 font-medium",
                        c.numeric && "text-right",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          navigate({ sort: c.key, dir: nextDir })
                        }
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-foreground",
                          active && "text-foreground",
                        )}
                      >
                        {c.label}
                        {active ? (
                          sort.dir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length}
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
                      {formatHours(r.hours_today)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatHours(r.hours_week)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatHours(r.hours_month)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatHours(r.avg_hours_per_day)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.days_worked_month}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function RangeChip({
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
        "rounded-md border px-3 py-1.5 text-xs font-medium",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function TeamChip({
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
        "rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
