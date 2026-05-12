"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TYPE_LABEL,
  type AttendanceLog,
  type AttendanceType,
} from "@/lib/attendance";
import { longDate } from "@/lib/date";
import { formatHours, formatTimeShort } from "@/lib/time";
import { cn } from "@/lib/utils";

const FILTER_TYPES: { key: AttendanceType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "present", label: "Present" },
  { key: "wfh", label: "WFH" },
  { key: "ewd", label: "EWD" },
  { key: "half_leave", label: "Half" },
  { key: "full_leave", label: "Full leave" },
  { key: "sick", label: "Sick" },
  { key: "holiday", label: "Holiday" },
];

interface HistoryTableProps {
  logs: AttendanceLog[];
  totals: Record<AttendanceType | "total", number>;
}

export function HistoryTable({ logs, totals }: HistoryTableProps) {
  const [activeType, setActiveType] = useState<AttendanceType | "all">("all");
  const [query, setQuery] = useState("");
  const [shortDaysOnly, setShortDaysOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (activeType !== "all" && l.type !== activeType) return false;
      if (q && !(l.reason ?? "").toLowerCase().includes(q)) return false;
      if (shortDaysOnly) {
        // "Hours < 6": only show worked days where total_hours is set
        // AND < 6. Days without total_hours (leave/missing checkin-out)
        // aren't "short days" — they're nothing-worked.
        if (l.total_hours == null) return false;
        if (Number(l.total_hours) >= 6) return false;
      }
      return true;
    });
  }, [logs, activeType, query, shortDaysOnly]);

  function exportCsv() {
    const headers = [
      "date",
      "type",
      "half",
      "reason",
      "status",
      "source",
      "checkin_time",
      "checkout_time",
      "total_hours",
      "created_at",
    ];
    const rows = filtered.map((l) => [
      l.date,
      l.type,
      l.half,
      (l.reason ?? "").replace(/"/g, '""'),
      l.status,
      l.source,
      l.checkin_time ?? "",
      l.checkout_time ?? "",
      l.total_hours ?? "",
      l.created_at,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${v}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* Lifetime totals */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Stat label="Total entries" value={totals.total} />
        <Stat label="Present" value={totals.present} />
        <Stat label="WFH" value={totals.wfh + totals.ewd} />
        <Stat
          label="Leave (full + sick + half)"
          value={totals.full_leave + totals.sick + totals.half_leave}
        />
      </div>

      {/* Filters + search + export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTER_TYPES.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveType(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activeType === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShortDaysOnly((v) => !v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              shortDaysOnly
                ? "border-amber-500 bg-amber-500/15 text-amber-900 dark:text-amber-200"
                : "border-border bg-background text-foreground hover:bg-muted",
            )}
            title="Show only days with logged hours below 6 (for self-discovery, not flagging)"
          >
            Hours &lt; 6
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reason…"
              className="pl-8 sm:w-56"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      {/* Mobile: card list. Desktop (sm+): table. */}
      <div className="space-y-2 sm:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border bg-card px-3 py-12 text-center text-sm text-muted-foreground">
            No entries match these filters.
          </div>
        ) : (
          filtered.map((l) => (
            <div key={l.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium tabular-nums">
                    {longDate(l.date)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground capitalize">
                    {TYPE_LABEL[l.type]}
                    {l.half !== "full" && ` · ${l.half.replace("_", " ")}`}
                    {" · "}
                    {l.source.replace("_", " ")}
                  </div>
                </div>
                <Badge
                  variant={
                    l.status === "rejected" ? "destructive" : "secondary"
                  }
                  className="capitalize"
                >
                  {l.status.replace("_", " ")}
                </Badge>
              </div>
              {(l.checkin_time || l.checkout_time || l.total_hours != null) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground tabular-nums">
                  {l.checkin_time && (
                    <span>In {formatTimeShort(l.checkin_time)}</span>
                  )}
                  {l.checkout_time && (
                    <span>Out {formatTimeShort(l.checkout_time)}</span>
                  )}
                  {l.total_hours != null && (
                    <span>{formatHours(l.total_hours, true)}</span>
                  )}
                </div>
              )}
              {l.reason && (
                <div className="mt-2 text-sm text-muted-foreground">
                  {l.reason}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="hidden overflow-hidden rounded-lg border bg-card sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">
                Half
              </th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">
                Check-in
              </th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">
                Check-out
              </th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">
                Hours
              </th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">
                Source
              </th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-12 text-center text-sm text-muted-foreground"
                >
                  No entries match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2 tabular-nums">
                    {longDate(l.date)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="capitalize">
                      {TYPE_LABEL[l.type]}
                    </Badge>
                  </td>
                  <td className="hidden px-3 py-2 capitalize md:table-cell">
                    {l.half === "full" ? "—" : l.half.replace("_", " ")}
                  </td>
                  <td className="hidden px-3 py-2 tabular-nums md:table-cell">
                    {l.checkin_time ? formatTimeShort(l.checkin_time) : "—"}
                  </td>
                  <td className="hidden px-3 py-2 tabular-nums md:table-cell">
                    {l.checkout_time ? formatTimeShort(l.checkout_time) : "—"}
                  </td>
                  <td className="hidden px-3 py-2 tabular-nums sm:table-cell">
                    {formatHours(l.total_hours)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {l.reason ?? "—"}
                  </td>
                  <td className="hidden px-3 py-2 capitalize lg:table-cell">
                    {l.source.replace("_", " ")}
                  </td>
                  <td className="hidden px-3 py-2 lg:table-cell">
                    <Badge
                      variant={
                        l.status === "rejected" ? "destructive" : "secondary"
                      }
                      className="capitalize"
                    >
                      {l.status.replace("_", " ")}
                    </Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
