import { CalendarCheck, CalendarX, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { TYPE_LABEL, type AttendanceLog } from "@/lib/attendance";
import { longDate } from "@/lib/date";

interface TodayBannerProps {
  todayISO: string;
  log: AttendanceLog | null;
  isWeekend: boolean;
  holidayName?: string | null;
}

export function TodayBanner({
  todayISO,
  log,
  isWeekend,
  holidayName,
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

  if (!log) {
    return (
      <Banner tone="warn" date={dateLabel} icon={CalendarX}>
        Today&apos;s attendance isn&apos;t marked yet.
      </Banner>
    );
  }

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

function Banner({
  tone,
  date,
  icon: Icon,
  children,
}: {
  tone: "primary" | "muted" | "warn";
  date: string;
  icon?: React.ComponentType<{ className?: string }>;
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
      </div>
    </section>
  );
}
