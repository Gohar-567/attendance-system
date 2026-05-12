import { Clock } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { type AttendanceLog } from "@/lib/attendance";
import { dowOf } from "@/lib/date";
import { formatHours } from "@/lib/time";

interface Props {
  monthLogs: AttendanceLog[];
  todayISO: string;
}

/**
 * Sum of total_hours for Mon → today.
 * Rows with NULL total_hours (leave / sick / missing checkin-out) don't
 * count toward the total — they're already nothing-worked.
 */
function computeWeekStats(monthLogs: AttendanceLog[], today: string) {
  const dow = dowOf(today); // 0=Sun … 6=Sat
  // Distance back to Monday: Mon→0, Tue→1, …, Sun→6.
  const daysBack = dow === 0 ? 6 : dow - 1;
  const [y, m, d] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - daysBack))
    .toISOString()
    .slice(0, 10);

  let total = 0;
  let daysCounted = 0;
  for (const l of monthLogs) {
    if (l.date < start || l.date > today) continue;
    if (l.total_hours == null) continue;
    total += Number(l.total_hours);
    daysCounted++;
  }
  return { total, daysCounted, weekStartISO: start };
}

export function HoursThisWeekCard({ monthLogs, todayISO }: Props) {
  const { total, daysCounted } = computeWeekStats(monthLogs, todayISO);

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Hours this week
          </div>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tabular-nums">
            {formatHours(total)}
          </span>
          <span className="text-sm text-muted-foreground">hrs</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {daysCounted === 0
            ? "Nothing logged yet"
            : `${daysCounted} day${daysCounted === 1 ? "" : "s"} · avg ${formatHours(
                total / daysCounted,
              )} hrs/day`}
        </div>
      </CardContent>
    </Card>
  );
}
