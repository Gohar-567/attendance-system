import { Clock } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { type WorkSession } from "@/lib/attendance";
import { dowOf } from "@/lib/date";
import { formatHours } from "@/lib/time";

interface Props {
  sessions: WorkSession[];
  todayISO: string;
}

/**
 * Sum of work-session durations for Mon → today, grouped by session_date
 * (the business day a session started on — so cross-midnight sessions
 * count toward the day they began). Open / invalid sessions don't count.
 */
function computeWeekStats(sessions: WorkSession[], today: string) {
  const dow = dowOf(today); // 0=Sun … 6=Sat
  const daysBack = dow === 0 ? 6 : dow - 1;
  const [y, m, d] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - daysBack))
    .toISOString()
    .slice(0, 10);

  let total = 0;
  const days = new Set<string>();
  for (const s of sessions) {
    if (s.session_date < start || s.session_date > today) continue;
    if (s.duration_hours == null) continue;
    total += Number(s.duration_hours);
    days.add(s.session_date);
  }
  return { total, daysCounted: days.size, weekStartISO: start };
}

export function HoursThisWeekCard({ sessions, todayISO }: Props) {
  const { total, daysCounted } = computeWeekStats(sessions, todayISO);

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
