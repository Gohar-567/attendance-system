"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { submitLeaveAction } from "@/app/actions/leave";
import { dowOf, longDate } from "@/lib/date";
import type { BalanceRow } from "@/lib/attendance";
import {
  LEAVE_TYPE_LABEL,
  type LeaveType,
} from "@/lib/leave/types";

interface LeaveFormProps {
  balance: BalanceRow | null;
  holidays: { date: string; name: string }[];
  teamLeaves: {
    employee_id: string;
    full_name: string;
    date: string;
    type: string;
  }[];
  today: string;
}

const TYPES: { value: LeaveType; label: string; sub: string }[] = [
  { value: "casual", label: "Casual", sub: "Personal time off" },
  { value: "sick", label: "Sick", sub: "Illness / appointments" },
  { value: "annual", label: "Annual", sub: "Vacation / planned PTO" },
];

export function LeaveForm({
  balance,
  holidays,
  teamLeaves,
  today,
}: LeaveFormProps) {
  const router = useRouter();
  const [type, setType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const holidaySet = useMemo(
    () => new Set(holidays.map((h) => h.date)),
    [holidays],
  );

  const { workingDays, calendarDays, dateRange } = useMemo(
    () => computeDays(fromDate, toDate, holidaySet),
    [fromDate, toDate, holidaySet],
  );

  const allowance =
    type === "casual"
      ? balance?.casual_allowance ?? 0
      : type === "sick"
        ? balance?.sick_allowance ?? 0
        : balance?.annual_allowance ?? 0;
  const used =
    type === "casual"
      ? balance?.casual_used ?? 0
      : type === "sick"
        ? balance?.sick_used ?? 0
        : balance?.annual_used ?? 0;
  const remaining = Math.max(0, allowance - used);
  const remainingAfter = allowance - used - workingDays;

  const conflicts = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return [];
    const map = new Map<string, { name: string; dates: string[] }>();
    for (const l of teamLeaves) {
      if (l.date < fromDate || l.date > toDate) continue;
      const cur = map.get(l.employee_id) ?? { name: l.full_name, dates: [] };
      cur.dates.push(l.date);
      map.set(l.employee_id, cur);
    }
    return [...map.values()].map((v) => ({
      ...v,
      dates: v.dates.sort(),
    }));
  }, [fromDate, toDate, teamLeaves]);

  const dateError = toDate < fromDate ? "End date is before start date" : null;
  const overBalance = remainingAfter < 0;
  const submittable = !dateError && workingDays > 0 && !pending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!submittable) return;
    startTransition(async () => {
      const res = await submitLeaveAction({
        type,
        fromDate,
        toDate,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't submit");
        return;
      }
      toast.success("Leave request submitted", {
        description: "Your approver has been notified.",
      });
      router.push("/me");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label>Type</Label>
            <RadioGroup
              value={type}
              onValueChange={(v) => setType(v as LeaveType)}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              {TYPES.map((t) => (
                <label
                  key={t.value}
                  htmlFor={`type-${t.value}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    type === t.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <RadioGroupItem
                    value={t.value}
                    id={`type-${t.value}`}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.sub}
                    </div>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  if (toDate < e.target.value) setToDate(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                min={fromDate}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
          {dateError && (
            <p className="text-xs text-destructive">{dateError}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="A short note for your approver"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            Live preview
          </div>

          <Stat label="Working days" value={`${workingDays}`} />
          <Stat
            label="Calendar days"
            value={`${calendarDays}`}
            sub={dateRange ?? undefined}
          />
          <Stat
            label={`${LEAVE_TYPE_LABEL[type]} balance`}
            value={`${remaining} / ${allowance}`}
          />
          <Stat
            label="Balance after this leave"
            value={
              overBalance
                ? `${remainingAfter} (over!)`
                : `${remainingAfter}`
            }
            tone={overBalance ? "warn" : "default"}
          />

          {overBalance && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                You&apos;d go {Math.abs(remainingAfter)} day
                {Math.abs(remainingAfter) === 1 ? "" : "s"} over your{" "}
                {LEAVE_TYPE_LABEL[type].toLowerCase()} allowance. Approvers
                can still grant it but they&apos;ll see the overage.
              </div>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <div className="font-medium">
                  Teammates already off in this range:
                </div>
                <ul className="mt-1 list-disc pl-4">
                  {conflicts.map((c) => (
                    <li key={c.name}>
                      <span className="font-medium">{c.name}</span> —{" "}
                      {c.dates.map((d) => longDate(d)).join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!submittable}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
      </div>
    </form>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div
        className={`text-base font-semibold tabular-nums ${
          tone === "warn"
            ? "text-amber-700 dark:text-amber-300"
            : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function computeDays(
  fromISO: string,
  toISO: string,
  holidays: ReadonlySet<string>,
): { workingDays: number; calendarDays: number; dateRange: string | null } {
  if (!fromISO || !toISO || toISO < fromISO) {
    return { workingDays: 0, calendarDays: 0, dateRange: null };
  }
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  let working = 0;
  let calendar = 0;
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    calendar++;
    const iso = new Date(t).toISOString().slice(0, 10);
    const dow = dowOf(iso);
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(iso)) continue;
    working++;
  }
  return {
    workingDays: working,
    calendarDays: calendar,
    dateRange: `${longDate(fromISO)} → ${longDate(toISO)}`,
  };
}
