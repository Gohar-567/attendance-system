"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
  TYPE_LABEL,
  type AttendanceHalf,
  type AttendanceLog,
} from "@/lib/attendance";
import { isWeekend, longDate, monthGrid } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  addBackdatedAttendanceAction,
  deleteAttendanceAction,
  editAttendanceAction,
  EDITABLE_TYPES,
  type EditableType,
} from "@/app/actions/attendance";

interface MonthCalendarProps {
  monthISO: string;
  todayISO: string;
  logs: AttendanceLog[];
  holidays: { date: string; name: string }[];
  /** Used to decide whether the viewer owns the row → can edit. */
  currentUserId: string;
  /** HR/admin can edit anything (including locked rows) + delete. */
  isHr: boolean;
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Editable" types the form exposes — mirrors EDITABLE_TYPES in the
 *  server action so the contract is symmetric. */
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
  holidays,
  currentUserId,
  isHr,
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

  /** A past empty weekday cell is the trigger for the backdate flow. */
  function isBackdatable(iso: string): boolean {
    if (iso >= todayISO) return false;
    if (isWeekend(iso)) return false;
    if (holidaysByDate.has(iso)) return false;
    if (logsByDate.has(iso)) return false;
    return true;
  }

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
          const canBackdate = isBackdatable(date);
          const future = date > todayISO;

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
              aria-label={
                canBackdate ? `Add entry for ${date}` : `Open ${date}`
              }
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
              {canBackdate && (
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
        holidayName={openHoliday}
        todayISO={todayISO}
        currentUserId={currentUserId}
        isHr={isHr}
        canBackdate={openDate ? isBackdatable(openDate) : false}
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
  holidayName,
  todayISO,
  currentUserId,
  isHr,
  canBackdate,
  onClose,
}: {
  date: string | null;
  log: AttendanceLog | null;
  holidayName: string | null;
  todayISO: string;
  currentUserId: string;
  isHr: boolean;
  canBackdate: boolean;
  onClose: () => void;
}) {
  const open = date !== null;
  const [mode, setMode] = useState<"view" | "edit" | "add">("view");

  // Whenever the dialog opens for a different day, reset to the right mode:
  // empty past weekday → straight into the add form; everything else → view.
  useEffect(() => {
    if (date) {
      setMode(!log && canBackdate ? "add" : "view");
    }
  }, [date, log, canBackdate]);

  const owns = !!log && log.employee_id === currentUserId;
  const locked = !!log && log.source === "leave_request" && log.status === "approved";
  const canEdit = !!log && (isHr || (owns && !locked));
  const canDelete = !!log && isHr;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {date
              ? mode === "add"
                ? `Add entry for ${longDate(date)}`
                : longDate(date)
              : ""}
          </DialogTitle>
          <DialogDescription>
            {date && date > todayISO
              ? "This day hasn't happened yet."
              : holidayName
                ? `Public holiday — ${holidayName}`
                : mode === "add"
                  ? "Fill in what you actually did that day."
                  : log
                    ? mode === "edit"
                      ? "Change the details. The previous values are kept in the audit log."
                      : "Attendance details and audit trail."
                    : date && isWeekend(date)
                      ? "Weekend — no entry needed."
                      : "No entry for this day."}
          </DialogDescription>
        </DialogHeader>

        {mode === "view" && log && (
          <ViewBody log={log} />
        )}

        {mode === "edit" && log && date && (
          <EditForm
            log={log}
            onSaved={() => {
              setMode("view");
              onClose();
            }}
            onCancel={() => setMode("view")}
          />
        )}

        {mode === "add" && date && (
          <AddForm
            date={date}
            onSaved={() => {
              setMode("view");
              onClose();
            }}
            onCancel={onClose}
          />
        )}

        {mode === "view" && (
          <DialogFooter>
            {log ? (
              <>
                {canEdit ? (
                  <Button
                    variant="outline"
                    onClick={() => setMode("edit")}
                  >
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

function ViewBody({ log }: { log: AttendanceLog }) {
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
      <Field
        label="Logged at"
        value={new Date(log.created_at).toLocaleString()}
      />
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
  );
}

function EditForm({
  log,
  onSaved,
  onCancel,
}: {
  log: AttendanceLog;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const initialType: EditableType = (
    EDITABLE_TYPES.includes(log.type as EditableType) ? log.type : "present"
  ) as EditableType;
  const [type, setType] = useState<EditableType>(initialType);
  const [half, setHalf] = useState<AttendanceHalf>(log.half);
  const [reason, setReason] = useState(log.reason ?? "");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      // half only matters when type is half_leave; for everything else
      // collapse to "full".
      const halfForServer: AttendanceHalf =
        type === "half_leave"
          ? half === "full"
            ? "first_half"
            : half
          : "full";
      const res = await editAttendanceAction({
        logId: log.id,
        type,
        half: halfForServer,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save");
        return;
      }
      toast.success("Updated");
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
      <ReasonField value={reason} onChange={setReason} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddForm({
  date,
  onSaved,
  onCancel,
}: {
  date: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<EditableType>("present");
  const [half, setHalf] = useState<AttendanceHalf>("first_half");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await addBackdatedAttendanceAction({
        date,
        type,
        half: type === "half_leave" ? half : "full",
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save");
        return;
      }
      toast.success(`Added entry for ${longDate(date)}`);
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
      <ReasonField value={reason} onChange={setReason} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add entry"}
        </Button>
      </DialogFooter>
    </form>
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
              <RadioGroupItem
                value={t.value}
                id={`edit-type-${t.value}`}
              />
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
                <RadioGroupItem
                  value={opt.value}
                  id={`edit-half-${opt.value}`}
                />
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
