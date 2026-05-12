"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { TYPE_LABEL } from "@/lib/attendance";
import type { TodayEmployeeRow } from "@/lib/admin/today";
import { cn } from "@/lib/utils";

interface TeamGridProps {
  rows: TodayEmployeeRow[];
  /** Show team-filter chips above the grid. Off for /admin/team. */
  filterByTeam?: boolean;
  /** When set, each tile becomes a Link to `${linkBase}/{employee_id}`.
   *  Used on /admin (HR) to deep-link to /admin/employees/[id]. */
  linkBase?: string;
}

const TONE: Record<string, { tile: string; text: string }> = {
  present: {
    tile: "bg-emerald-500/15 border-emerald-500/40",
    text: "text-emerald-900 dark:text-emerald-200",
  },
  wfh: {
    tile: "bg-blue-500/15 border-blue-500/40",
    text: "text-blue-900 dark:text-blue-200",
  },
  ewd: {
    tile: "bg-blue-500/15 border-blue-500/40",
    text: "text-blue-900 dark:text-blue-200",
  },
  half_leave: {
    tile: "bg-amber-500/20 border-amber-500/50",
    text: "text-amber-900 dark:text-amber-200",
  },
  full_leave: {
    tile: "bg-red-500/15 border-red-500/40",
    text: "text-red-900 dark:text-red-200",
  },
  sick: {
    tile: "bg-red-500/15 border-red-500/40",
    text: "text-red-900 dark:text-red-200",
  },
  holiday: {
    tile: "bg-muted border-border",
    text: "text-muted-foreground",
  },
  unmarked: {
    tile: "bg-background border-dashed border-border",
    text: "text-muted-foreground",
  },
};

export function TeamGrid({
  rows,
  filterByTeam = true,
  linkBase,
}: TeamGridProps) {
  const teams = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (r.team_id && r.team_name) m.set(r.team_id, r.team_name);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const [activeTeam, setActiveTeam] = useState<string | "all">("all");
  const visible = useMemo(() => {
    if (activeTeam === "all") return rows;
    return rows.filter((r) => r.team_id === activeTeam);
  }, [activeTeam, rows]);

  return (
    <div className="space-y-3">
      {filterByTeam && teams.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Chip
            active={activeTeam === "all"}
            onClick={() => setActiveTeam("all")}
            label={`All (${rows.length})`}
          />
          {teams.map(([id, name]) => (
            <Chip
              key={id}
              active={activeTeam === id}
              onClick={() => setActiveTeam(id)}
              label={`${name} (${rows.filter((r) => r.team_id === id).length})`}
            />
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
            No active employees in this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {visible.map((r) => {
            const tone = TONE[r.status] ?? TONE.unmarked;
            const body = (
              <>
                <div
                  className="truncate text-sm font-semibold"
                  title={r.full_name}
                >
                  {r.full_name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.team_name ?? "No team"}
                </div>
                <div
                  className={cn(
                    "mt-2 text-xs font-medium capitalize",
                    tone.text,
                  )}
                >
                  {r.status === "unmarked"
                    ? "Unmarked"
                    : TYPE_LABEL[r.status as keyof typeof TYPE_LABEL] ??
                      r.status}
                  {r.half && r.half !== "full" && (
                    <span className="ml-1 text-[10px] opacity-80">
                      · {r.half.replace("_", " ")}
                    </span>
                  )}
                </div>
              </>
            );
            const className = cn(
              "block rounded-lg border p-3 transition-colors",
              tone.tile,
              linkBase && "hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            );
            return linkBase ? (
              <Link
                key={r.employee_id}
                href={`${linkBase}/${r.employee_id}`}
                className={className}
              >
                {body}
              </Link>
            ) : (
              <div key={r.employee_id} className={className}>
                {body}
              </div>
            );
          })}
        </div>
      )}
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
