import { Briefcase, HeartPulse, Plane, Home } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { BalanceRow } from "@/lib/attendance";

interface BalanceCardsProps {
  balance: BalanceRow | null;
  wfhThisMonth: number;
}

/**
 * 4-card grid: Casual / Sick / Annual / WFH this month.
 * 2-col on mobile, 4-col at sm: per spec.
 */
export function BalanceCards({ balance, wfhThisMonth }: BalanceCardsProps) {
  const items = [
    {
      label: "Casual",
      icon: Briefcase,
      used: balance?.casual_used ?? 0,
      total: balance?.casual_allowance ?? 0,
      kind: "balance" as const,
    },
    {
      label: "Sick",
      icon: HeartPulse,
      used: balance?.sick_used ?? 0,
      total: balance?.sick_allowance ?? 0,
      kind: "balance" as const,
    },
    {
      label: "Annual",
      icon: Plane,
      used: balance?.annual_used ?? 0,
      total: balance?.annual_allowance ?? 0,
      kind: "balance" as const,
    },
    {
      label: "WFH this month",
      icon: Home,
      used: wfhThisMonth,
      total: 0,
      kind: "count" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {it.label}
              </div>
              <it.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums">
                {it.used}
              </span>
              {it.kind === "balance" ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  / {it.total}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">days</span>
              )}
            </div>
            {it.kind === "balance" && (
              <div className="mt-1 text-xs text-muted-foreground">
                {Math.max(0, it.total - it.used)} remaining
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
