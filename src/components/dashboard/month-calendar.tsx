"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  cellClassesFor,
  cellGlyph,
  EDITABLE_TYPES,
  isSessionType,
  TYPE_LABEL,
  type AttendanceHalf,
  type AttendanceLog,
  type EditableType,
  type WorkSession,
} from "@/lib/attendance";
import { firstOfMonthISO, isWeekend, longDate, monthGrid, monthLabel } from "@/lib/date";
import { durationHours, MAX_SESSION_HOURS } from "@/lib/business-day";
import {
  formatHours,
  formatInstantTime,
  instantToLocalInput,
  localInputToInstant,
} from "@/lib/time";
import { cn } from "@/lib/utils";
import { saveDayAction } from "@/app/actions/sessions";
import { deleteAttendanceAction } from "@/app/actions/attendance";
import type { DaySessionInput } from "@/app/actions/types";

interface MonthCalendarProps {
  monthISO: string;
  todayISO: string;
  logs: AttendanceLog[];
  sessions: WorkSession[];
  holidays: { date: string; name: string }[];
  /** Used to decide whether the viewer owns the row → can edit. */
  currentUserId: string;
  /** HR/admin can edit anything (including locked rows) + delete. */
  isHr: boolean;
  /** When set, inserts target this employee instead of the signed-in
   *  viewer. Used on `/admin/employees/[id]`. */
  targetEmployeeId?: string;
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TYPE_OPTIONS: { value: EditableType; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "wfh", label: "WFH" },
  { value: "ewd", label: "EWD" },
  { value: "half_leave", label: "Half leave" },
  { value: "sick", label: "Sick" },
];

export function MonthCalendar({
  monthISO,
  todayISO,
  logs,
  sessions,
  holidays,
  currentUserId,
  isHr,
  targetEmployeeId,
}: MonthCalendarProps) {
  const grid = useMemo(() => monthGrid(monthISO), [monthISO]);
  const logsByDate = useMemo(() => {
    const map = new Map<string, AttendanceLog>();
    for (const l of logs) map.set(l.date, l);
    return map;
  }, [logs]);
  // Sessions grouped by the business day they belong to.
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, WorkSession[]>();
    for (const s of sessions) {
      const list = map.get(s.session_date) ?? [];
      list.push(s);
      map.set(s.session_date, list);
    }
    return map;
  }, [sessions]);
  const holidaysByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays) map.set(h.date, h.name);
    return map;
  }, [holidays]);

  const [openDate, setOpenDate] = useState<string | null>(null);

  const openLog = openDate ? logsByDate.get(openDate) ?? null : null;
  const openHoliday = openDate ? holidaysByDate.get(openDate) ?? null : null;
  const openSessions = openDate ? sessionsByDate.get(openDate) ?? [] : [];

  // Month navigation: URL query string is the source of truth.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentMonthISO = firstOfMonthISO(todayISO);
  const viewedMonthISO = firstOfMonthISO(monthISO);
  const minMonthISO = addMonths(currentMonthISO, -6);

  const onCurrentMonth = viewedMonthISO === currentMonthISO;
  const onMinMonth = viewedMonthISO <= minMonthISO;

  function navigateToMonth(targetISO: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (firstOfMonthISO(targetISO) === currentMonthISO) {
      params.delete("month");
    } else {
      params.set("month", targetISO.slice(0, 7));
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={onMinMonth}
          onClick={() => navigateToMonth(addMonths(viewedMonthISO, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <button
          type="button"
          onClick={() => navigateToMonth(currentMonthISO)}
          disabled={onCurrentMonth}
          title={onCurrentMonth ? "Current month" : "Jump to current month"}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors",
            !onCurrentMonth && "hover:bg-muted",
          )}
        >
          {monthLabel(monthISO)}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={onCurrentMonth}
          onClick={() => navigateToMonth(addMonths(viewedMonthISO, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

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
          const hoursDisplay =
            log?.total_hours != null ? formatHours(log.total_hours) : null;
          const glyph =
            hoursDisplay || cellGlyph(log) || (holidayName ? "H" : "");
          const day = Number(date.slice(8, 10));
          const future = date > todayISO;
          // Any past/today cell with no entry yet is "addable" — Phase 9
          // allows weekends and holidays too.
          const canAdd = !future && !log;

          return (
            <button
              key={date}
              type="button"
              onClick={() => setOpenDate(date)}
              disabled={future}
              className={cn(
                "group relative aspect-square rounded-md border p-1 text-left text-xs transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-1.5",
                cls,
                !inMonth && "opacity-40",
                future && "cursor-not-allowed",
              )}
              aria-label={canAdd ? `Add entry for ${date}` : `Open ${date}`}
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
              {canAdd && (
                <Plus
                  className="pointer-events-none absolute inset-0 m-auto h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      <Legend />

      <DayDetailDialog
        date={openDate}
        log={openLog}
        sessions={openSessions}
        holidayName={openHoliday}
        todayISO={todayISO}
        currentUserId={currentUserId}
        isHr={isHr}
        targetEmployeeId={targetEmployeeId}
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

/** Detail / edit / add modal. Mode flips inside the same Dialog. */
function DayDetailDialog({
  date,
  log,
  sessions,
  holidayName,
  todayISO,
  currentUserId,
  isHr,
  targetEmployeeId,
  onClose,
}: {
  date: string | null;
  log: AttendanceLog | null;
  sessions: WorkSession[];
  holidayName: string | null;
  todayISO: string;
  currentUserId: string;
  isHr: boolean;
  targetEmployeeId?: string;
  onClose: () => void;
}) {
  const open = date !== null;
  const [mode, setMode] = useState<"view" | "edit">("view");

  // Empty past/today cell → straight into the edit (add) form; else view.
  useEffect(() => {
    if (date) setMode(log ? "view" : "edit");
  }, [date, log]);

  const owns = targetEmployeeId
    ? targetEmployeeId === (log?.employee_id ?? targetEmployeeId)
    : !log || log.employee_id === currentUserId;
  const locked =
    !!log && log.source === "leave_request" && log.status === "approved";
  const canEdit = isHr || (owns && !locked);
  const canDelete = !!log && isHr;
  const weekend = date ? isWeekend(date) : false;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {date ? (mode === "edit" && !log ? `Add entry for ${longDate(date)}` : longDate(date)) : ""}
            {holidayName && (
              <Badge variant="secondary" className="font-normal">
                {holidayName}
              </Badge>
            )}
            {!holidayName && weekend && (
              <Badge variant="outline" className="font-normal">
                Weekend
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {date && date > todayISO
              ? "This day hasn't happened yet."
              : mode === "edit"
                ? log
                  ? "Change the details. Previous values are kept in the audit log."
                  : "Log what you actually did — add one or more work sessions."
                : "Attendance details and work sessions."}
          </DialogDescription>
        </DialogHeader>

        {mode === "view" && log && <ViewBody log={log} sessions={sessions} />}

        {mode === "edit" && date && (
          <DayForm
            date={date}
            log={log}
            sessions={sessions}
            targetEmployeeId={targetEmployeeId}
            onSaved={onClose}
            onCancel={log ? () => setMode("view") : onClose}
          />
        )}

        {mode === "view" && (
          <DialogFooter>
            {log ? (
              <>
                {canEdit ? (
                  <Button variant="outline" onClick={() => setMode("edit")}>
                    Edit
                  </Button>
                ) : locked ? (
                  <Button
                    variant="outline"
                    disabled
                    title="This entry came from an approved leave request. Ask HR to change it."
                  >
                    Edit (locked)
                  </Button>
                ) : null}
                {canDelete && <DeleteButton logId={log.id} onDeleted={onClose} />}
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewBody({
  log,
  sessions,
}: {
  log: AttendanceLog;
  sessions: WorkSession[];
}) {
  return (
    <div className="space-y-3 text-sm">
      <Field label="Type" value={TYPE_LABEL[log.type]} />
      {log.half !== "full" && (
        <Field
          label="Half"
          value={log.half === "first_half" ? "First half" : "Second half"}
        />
      )}
      {log.reason && <Field label="Reason" value={log.reason} />}

      {isSessionType(log.type) && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sessions
          </div>
          {sessions.length === 0 ? (
            <p className="text-muted-foreground">No sessions logged.</p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <span className="tabular-nums">
                    {formatInstantTime(s.started_at)} –{" "}
                    {s.ended_at ? formatInstantTime(s.ended_at) : "open"}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {s.ended_at == null
                      ? "open"
                      : s.duration_hours == null
                        ? "—"
                        : formatHours(s.duration_hours, true)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {log.total_hours != null && (
        <Field label="Total hours" value={formatHours(log.total_hours, true)} />
      )}
      <Field
        label="Source"
        value={
          <Badge variant="outline" className="capitalize">
            {log.source.replace(/_/g, " ")}
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
            {log.status.replace(/_/g, " ")}
          </Badge>
        }
      />
      <Field label="Logged at" value={new Date(log.created_at).toLocaleString()} />
      {log.updated_at !== log.created_at && (
        <Field label="Updated at" value={new Date(log.updated_at).toLocaleString()} />
      )}
    </div>
  );
}

interface SessionRow {
  key: string;
  id?: string;
  /** datetime-local strings (Karachi wall time). */
  start: string;
  end: string;
}

let rowSeq = 0;
function newRowKey(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

function DayForm({
  date,
  log,
  sessions,
  targetEmployeeId,
  onSaved,
  onCancel,
}: {
  date: string;
  log: AttendanceLog | null;
  sessions: WorkSession[];
  targetEmployeeId?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const initialType: EditableType = (
    log && EDITABLE_TYPES.includes(log.type as EditableType)
      ? log.type
      : "present"
  ) as EditableType;
  const [type, setType] = useState<EditableType>(initialType);
  const [half, setHalf] = useState<AttendanceHalf>(
    log && log.half !== "full" ? log.half : "first_half",
  );
  const [reason, setReason] = useState(log?.reason ?? "");
  const [rows, setRows] = useState<SessionRow[]>(() =>
    sessions.map((s) => ({
      key: newRowKey(),
      id: s.id,
      start: instantToLocalInput(s.started_at),
      end: s.ended_at ? instantToLocalInput(s.ended_at) : "",
    })),
  );
  const [pending, startTransition] = useTransition();

  const showSessions = isSessionType(type);

  function addRow() {
    setRows((r) => [
      ...r,
      { key: newRowKey(), start: `${date}T09:00`, end: `${date}T17:00` },
    ]);
  }
  function removeRow(key: string) {
    setRows((r) => r.filter((x) => x.key !== key));
  }
  function patchRow(key: string, patch: Partial<SessionRow>) {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  // Live total of valid, closed sessions.
  const liveTotal = useMemo(() => {
    if (!showSessions) return type === "half_leave" ? 4 : null;
    let total = 0;
    for (const row of rows) {
      const startISO = localInputToInstant(row.start);
      const endISO = row.end ? localInputToInstant(row.end) : null;
      if (!startISO || !endISO) continue;
      const d = durationHours(startISO, endISO);
      if (d > 0 && d <= MAX_SESSION_HOURS) total += d;
    }
    return total;
  }, [rows, showSessions, type]);

  function submit(e: React.FormEvent) {
    e.preventDefault();

    const sessionInputs: DaySessionInput[] = [];
    if (showSessions) {
      for (const row of rows) {
        const startISO = localInputToInstant(row.start);
        if (!startISO) {
          toast.error("Each session needs a valid start time");
          return;
        }
        const endISO = row.end ? localInputToInstant(row.end) : null;
        if (endISO) {
          const d = durationHours(startISO, endISO);
          if (d <= 0) {
            toast.error("Each session's end must be after its start");
            return;
          }
          if (d > MAX_SESSION_HOURS) {
            toast.error(`A session is over ${MAX_SESSION_HOURS} hours`);
            return;
          }
        }
        sessionInputs.push({
          id: row.id,
          startedAt: startISO,
          endedAt: endISO,
        });
      }
    }

    startTransition(async () => {
      const res = await saveDayAction({
        date,
        employeeId: targetEmployeeId,
        logId: log?.id,
        type,
        half: type === "half_leave" ? half : "full",
        reason: reason.trim() || null,
        sessions: sessionInputs,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save");
        return;
      }
      toast.success(log ? "Updated" : `Added entry for ${longDate(date)}`);
      onSaved();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      <TypeAndHalfFields
        type={type}
        half={half}
        onTypeChange={setType}
        onHalfChange={setHalf}
      />

      {showSessions && (
        <SessionsEditor
          rows={rows}
          onAdd={addRow}
          onRemove={removeRow}
          onPatch={patchRow}
          liveTotal={liveTotal}
        />
      )}

      <ReasonField value={reason} onChange={setReason} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : log ? "Save" : "Add entry"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SessionsEditor({
  rows,
  onAdd,
  onRemove,
  onPatch,
  liveTotal,
}: {
  rows: SessionRow[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onPatch: (key: string, patch: Partial<SessionRow>) => void;
  liveTotal: number | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Sessions</Label>
        {rows.length > 5 && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            That&apos;s a lot of sessions — double-check.
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No sessions yet. Add one for each continuous work period.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`start-${row.key}`} className="text-xs">
                Start
              </Label>
              <input
                id={`start-${row.key}`}
                type="datetime-local"
                value={row.start}
                onChange={(e) => onPatch(row.key, { start: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor={`end-${row.key}`} className="text-xs">
                End (blank = open)
              </Label>
              <input
                id={`end-${row.key}`}
                type="datetime-local"
                value={row.end}
                onChange={(e) => onPatch(row.key, { end: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(row.key)}
              aria-label="Remove session"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add session
        </Button>
        <span className="text-xs text-muted-foreground">
          {liveTotal == null || liveTotal === 0
            ? "Total appears as you fill in sessions."
            : `Total: ${formatHours(liveTotal, true)}`}
        </span>
      </div>
    </div>
  );
}

function TypeAndHalfFields({
  type,
  half,
  onTypeChange,
  onHalfChange,
}: {
  type: EditableType;
  half: AttendanceHalf;
  onTypeChange: (v: EditableType) => void;
  onHalfChange: (v: AttendanceHalf) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label>Type</Label>
        <RadioGroup
          value={type}
          onValueChange={(v) => onTypeChange(v as EditableType)}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {TYPE_OPTIONS.map((t) => (
            <label
              key={t.value}
              htmlFor={`edit-type-${t.value}`}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors",
                type === t.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <RadioGroupItem value={t.value} id={`edit-type-${t.value}`} />
              <span>{t.label}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {type === "half_leave" && (
        <div className="space-y-2">
          <Label>Which half?</Label>
          <RadioGroup
            value={half === "full" ? "first_half" : half}
            onValueChange={(v) => onHalfChange(v as AttendanceHalf)}
            className="grid grid-cols-2 gap-2"
          >
            {[
              { value: "first_half" as const, label: "First half (morning off)" },
              { value: "second_half" as const, label: "Second half (afternoon off)" },
            ].map((opt) => (
              <label
                key={opt.value}
                htmlFor={`edit-half-${opt.value}`}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors",
                  half === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <RadioGroupItem value={opt.value} id={`edit-half-${opt.value}`} />
                <span>{opt.label}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
      )}
    </>
  );
}

function ReasonField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="edit-reason">Reason (optional)</Label>
      <Textarea
        id="edit-reason"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        placeholder="A short note for context"
      />
    </div>
  );
}

function DeleteButton({
  logId,
  onDeleted,
}: {
  logId: string;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Delete this attendance entry? This can't be undone.")) {
      return;
    }
    startTransition(async () => {
      const res = await deleteAttendanceAction(logId);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't delete");
        return;
      }
      toast.success("Entry deleted");
      onDeleted();
    });
  }

  return (
    <Button variant="destructive" onClick={handleDelete} disabled={pending}>
      {pending ? "Deleting…" : "Delete"}
    </Button>
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

/** "2026-05-01" + n months → first-of-target-month ISO. */
function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
