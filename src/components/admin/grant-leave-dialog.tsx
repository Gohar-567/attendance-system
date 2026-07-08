"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { grantLeaveAction } from "@/app/actions/leave";
import { todayISO } from "@/lib/date";
import { cn } from "@/lib/utils";
import { LEAVE_TYPE_LABEL, type LeaveType } from "@/lib/leave/types";

const TYPES: LeaveType[] = ["casual", "sick", "annual"];

/**
 * HR-only "Grant leave" action for /admin/employees/[id]. Creates an already
 * approved leave_request for this employee, which moves their balance card
 * and fills their calendar — no apply/approve step.
 */
export function GrantLeaveDialog({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setType("casual");
    setFromDate(todayISO());
    setToDate(todayISO());
    setReason("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (toDate < fromDate) {
      toast.error("End date is before start date");
      return;
    }
    startTransition(async () => {
      const res = await grantLeaveAction({
        employeeId,
        type,
        fromDate,
        toDate,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't grant leave");
        return;
      }
      toast.success(`Granted ${LEAVE_TYPE_LABEL[type]} leave to ${employeeName}`);
      reset();
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Grant leave
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Grant leave</DialogTitle>
              <DialogDescription>
                Records an approved leave for{" "}
                <span className="font-medium text-foreground">
                  {employeeName}
                </span>{" "}
                and updates their balance immediately. No approval needed.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label>Type</Label>
              <RadioGroup
                value={type}
                onValueChange={(v) => setType(v as LeaveType)}
                className="grid grid-cols-3 gap-2"
              >
                {TYPES.map((t) => (
                  <label
                    key={t}
                    htmlFor={`grant-type-${t}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors",
                      type === t
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <RadioGroupItem value={t} id={`grant-type-${t}`} />
                    <span>{LEAVE_TYPE_LABEL[t]}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="grant-from">From</Label>
                <Input
                  id="grant-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grant-to">To</Label>
                <Input
                  id="grant-to"
                  type="date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => setToDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="grant-reason">Reason (optional)</Label>
              <Textarea
                id="grant-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="e.g. Carried-over annual leave, approved offline"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Weekends and holidays in the range are skipped when filling the
              calendar. Only working days are written.
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Granting…" : "Grant leave"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
