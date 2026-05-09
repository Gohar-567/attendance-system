"use client";

import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  cellClassesFor,
  cellGlyph,
  TYPE_LABEL,
  type AttendanceLog,
} from "@/lib/attendance";
import { isWeekend, longDate, monthGrid } from "@/lib/date";

interface MonthCalendarProps {
  monthISO: string;
  todayISO: string;
  logs: AttendanceLog[];
  holidays: { date: string; name: string }[];
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthCalendar({
  monthISO,
  todayISO,
  logs,
  holidays,
}: MonthCalendarProps) {
  const grid = useMemo(() => monthGrid(monthISO), [monthISO]);
  const logsByDate = useMemo(() => {
    const map = new Map<string, AttendanceLog>();
    for (const l of logs) map.set(l.date, l);
    return map;
  }, [logs]);
  const holidaysByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays) map.set(h.date, h.name);
    return map;
  }, [holidays]);

  const [openDate, setOpenDate] = useState<string | null>(null);

  const openLog = openDate ? logsByDate.get(openDate) ?? null : null;
  const openHoliday = openDate ? holidaysByDate.get(openDate) ?? null : null;

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 px-1 pb-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {DOW_LABELS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {grid.map(({ date, inMonth }) => {
          const log = logsByDate.get(date) ?? null;
          const holidayName = holidaysByDate.get(date) ?? null;
          const cls = cellClassesFor({
            log,
            isHoliday: !!holidayName,
            iso: date,
            todayISO,
          });
          const glyph = cellGlyph(log) || (holidayName ? "H" : "");
          const day = Number(date.slice(8, 10));

          return (
            <button
              key={date}
              type="button"
              onClick={() => setOpenDate(date)}
              className={`group aspect-square rounded-md border p-1 text-left text-xs transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-1.5 ${cls} ${
                inMonth ? "" : "opacity-40"
              }`}
              aria-label={`Open ${date}`}
            >
              <div className="flex h-full flex-col">
                <div className="text-[11px] font-semibold tabular-nums sm:text-xs">
                  {day}
                </div>
                {glyph && (
                  <div className="mt-auto self-end text-[10px] font-medium leading-none sm:text-[11px]">
                    {glyph}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <Legend />

      <DayDetailDialog
        date={openDate}
        log={openLog}
        holidayName={openHoliday}
        todayISO={todayISO}
        onClose={() => setOpenDate(null)}
      />
    </div>
  );
}

function Legend() {
  const items: { label: string; cls: string }[] = [
    { label: "Present", cls: "bg-emerald-500/30 border-emerald-500/50" },
    { label: "WFH / EWD", cls: "bg-blue-500/30 border-blue-500/50" },
    { label: "Half", cls: "bg-amber-500/30 border-amber-500/60" },
    { label: "Leave / Sick", cls: "bg-red-500/30 border-red-500/50" },
    { label: "Off", cls: "bg-muted border-border" },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 rounded-sm border ${it.cls}`}
            aria-hidden
          />
          {it.label}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 rounded-sm border border-dashed border-border"
          aria-hidden
        />
        Future
      </div>
    </div>
  );
}

function DayDetailDialog({
  date,
  log,
  holidayName,
  todayISO,
  onClose,
}: {
  date: string | null;
  log: AttendanceLog | null;
  holidayName: string | null;
  todayISO: string;
  onClose: () => void;
}) {
  const open = date !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{date ? longDate(date) : ""}</DialogTitle>
          <DialogDescription>
            {date && date > todayISO
              ? "This day hasn't happened yet."
              : holidayName
                ? `Public holiday — ${holidayName}`
                : log
                  ? "Attendance details and audit trail."
                  : date && isWeekend(date)
                    ? "Weekend — no entry needed."
                    : "No entry for this day."}
          </DialogDescription>
        </DialogHeader>

        {log && (
          <div className="space-y-3 text-sm">
            <Field label="Type" value={TYPE_LABEL[log.type]} />
            {log.half !== "full" && (
              <Field
                label="Half"
                value={log.half === "first_half" ? "First half" : "Second half"}
              />
            )}
            {log.reason && <Field label="Reason" value={log.reason} />}
            <Field
              label="Source"
              value={
                <Badge variant="outline" className="capitalize">
                  {log.source.replace("_", " ")}
                </Badge>
              }
            />
            <Field
              label="Status"
              value={
                <Badge
                  variant={log.status === "rejected" ? "destructive" : "secondary"}
                  className="capitalize"
                >
                  {log.status.replace("_", " ")}
                </Badge>
              }
            />
            <Field label="Logged at" value={new Date(log.created_at).toLocaleString()} />
            {log.updated_at !== log.created_at && (
              <Field
                label="Updated at"
                value={new Date(log.updated_at).toLocaleString()}
              />
            )}
            {log.slack_message_ts && (
              <Field label="Slack message" value={log.slack_message_ts} />
            )}
          </div>
        )}

        <DialogFooter>
          {log ? (
            <>
              <Button variant="outline" disabled title="Coming in Phase 4">
                Edit
              </Button>
              <Button variant="destructive" disabled title="Coming in Phase 4">
                Delete
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 items-center gap-2">
      <dt className="col-span-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="col-span-2">{value}</dd>
    </div>
  );
}
