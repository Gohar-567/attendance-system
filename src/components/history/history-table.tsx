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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (activeType !== "all" && l.type !== activeType) return false;
      if (q && !(l.reason ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, activeType, query]);

  function exportCsv() {
    const headers = [
      "date",
      "type",
      "half",
      "reason",
      "status",
      "source",
      "created_at",
    ];
    const rows = filtered.map((l) => [
      l.date,
      l.type,
      l.half,
      (l.reason ?? "").replace(/"/g, '""'),
      l.status,
      l.source,
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

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">
                Half
              </th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">
                Source
              </th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
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
                  <td className="hidden px-3 py-2 capitalize sm:table-cell">
                    {l.half === "full" ? "—" : l.half.replace("_", " ")}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {l.reason ?? "—"}
                  </td>
                  <td className="hidden px-3 py-2 capitalize sm:table-cell">
                    {l.source.replace("_", " ")}
                  </td>
                  <td className="hidden px-3 py-2 md:table-cell">
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
