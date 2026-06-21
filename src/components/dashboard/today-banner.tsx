import { CalendarCheck, CalendarX, Clock, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CheckInOutControls } from "@/components/dashboard/check-in-out-controls";
import { TYPE_LABEL, type AttendanceLog, type WorkSession } from "@/lib/attendance";
import { longDate } from "@/lib/date";
import { formatHours, formatInstantTime } from "@/lib/time";

interface TodayBannerProps {
  todayISO: string;
  log: AttendanceLog | null;
  /** Today's work sessions (business day = today). */
  sessions?: WorkSession[];
  isWeekend: boolean;
  holidayName?: string | null;
  /** Hide the check-in / check-out buttons when HR is viewing another
   *  employee's calendar (we don't want HR to "check in" on someone
   *  else's behalf with a single click — the edit form is the path). */
  showCheckinControls?: boolean;
}

export function TodayBanner({
  todayISO,
  log,
  sessions = [],
  isWeekend,
  holidayName,
  showCheckinControls = true,
}: TodayBannerProps) {
  const dateLabel = longDate(todayISO);

  if (holidayName) {
    return (
      <Banner tone="muted" date={dateLabel}>
        <span className="font-semibold">Public holiday</span> · {holidayName}
      </Banner>
    );
  }

  if (isWeekend) {
    return (
      <Banner tone="muted" date={dateLabel}>
        <span className="font-semibold">Weekend</span> · enjoy.
      </Banner>
    );
  }

  // No row at all — invite the user to check in.
  if (!log) {
    return (
      <Banner
        tone="warn"
        date={dateLabel}
        icon={CalendarX}
        actions={
          showCheckinControls ? (
            <CheckInOutControls state="needs_checkin" />
          ) : null
        }
      >
        You haven&apos;t checked in today.
      </Banner>
    );
  }

  // Leave / sick / holiday — show type label only, no check-in UI.
  const isLeaveType =
    log.type === "full_leave" ||
    log.type === "sick" ||
    log.type === "holiday";

  if (isLeaveType) {
    return (
      <Banner tone="primary" date={dateLabel} icon={CalendarCheck}>
        <span className="font-semibold">{TYPE_LABEL[log.type]}</span>
        {log.half !== "full" && (
          <span className="ml-1 text-blue-100">
            · {log.half === "first_half" ? "first half" : "second half"}
          </span>
        )}
        {log.status === "auto_logged" && (
          <Badge
            variant="secondary"
            className="ml-3 border-white/20 bg-white/15 text-blue-50"
          >
            <Sparkles className="mr-1 h-3 w-3" />
            Auto-logged
          </Badge>
        )}
        {log.reason && (
          <div className="mt-1 text-sm font-normal text-blue-100">
            {log.reason}
          </div>
        )}
      </Banner>
    );
  }

  // Present / WFH / EWD / Half — show session timeline.
  const openSession = sessions.find((s) => s.ended_at == null) ?? null;
  const closedSessions = sessions.filter((s) => s.ended_at != null);
  const hasAnySession = sessions.length > 0;
  const firstStart = sessions[0]?.started_at ?? null;
  const lastEnd =
    closedSessions.length > 0
      ? closedSessions[closedSessions.length - 1].ended_at
      : null;
  const state: "needs_checkin" | "needs_checkout" | "done" = openSession
    ? "needs_checkout"
    : hasAnySession
      ? "done"
      : "needs_checkin";

  return (
    <Banner
      tone="primary"
      date={dateLabel}
      icon={CalendarCheck}
      actions={
        showCheckinControls && log.type !== "half_leave" ? (
          <CheckInOutControls state={state} />
        ) : null
      }
    >
      <span className="font-semibold">{TYPE_LABEL[log.type]}</span>
      {log.half !== "full" && (
        <span className="ml-1 text-blue-100">
          · {log.half === "first_half" ? "first half" : "second half"}
        </span>
      )}
      {log.status === "auto_logged" && (
        <Badge
          variant="secondary"
          className="ml-3 border-white/20 bg-white/15 text-blue-50"
        >
          <Sparkles className="mr-1 h-3 w-3" />
          Auto-logged
        </Badge>
      )}
      {log.type !== "half_leave" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-normal text-blue-50/95">
          {firstStart ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 opacity-80" />
              Checked in <strong>{formatInstantTime(firstStart)}</strong>
            </span>
          ) : (
            <span className="opacity-90">Not checked in yet</span>
          )}
          {openSession && <span>· session open</span>}
          {lastEnd && (
            <span>
              · Last out <strong>{formatInstantTime(lastEnd)}</strong>
            </span>
          )}
          {sessions.length > 1 && (
            <span>· {sessions.length} sessions</span>
          )}
          {log.total_hours != null && (
            <span>
              · <strong>{formatHours(log.total_hours, true)}</strong>
            </span>
          )}
        </div>
      )}
      {log.reason && log.type === "half_leave" && (
        <div className="mt-1 text-sm font-normal text-blue-100">
          {log.reason}
        </div>
      )}
    </Banner>
  );
}

function Banner({
  tone,
  date,
  icon: Icon,
  actions,
  children,
}: {
  tone: "primary" | "muted" | "warn";
  date: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === "primary"
      ? "bg-blue-600 text-white"
      : tone === "warn"
        ? "bg-amber-500/90 text-amber-950"
        : "bg-muted text-foreground";

  return (
    <section className={`rounded-xl px-5 py-4 shadow-sm ${cls}`}>
      <div className="flex items-start gap-3">
        {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide opacity-80">
            {date}
          </div>
          <div className="mt-1 text-base sm:text-lg">{children}</div>
        </div>
        {actions && <div className="ml-2 shrink-0">{actions}</div>}
      </div>
    </section>
  );
}
