"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideLeaveAction } from "@/app/actions/leave";
import { LEAVE_TYPE_LABEL, type LeaveRequest } from "@/lib/leave/types";
import { longDate } from "@/lib/date";

export interface ApprovalItem {
  request: LeaveRequest;
  requesterName: string;
  requesterTeam: string | null;
  escalated: boolean;
}

export function ApprovalsList({ items }: { items: ApprovalItem[] }) {
  const [list, setList] = useState(items);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<ApprovalItem | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [, startTransition] = useTransition();

  function approve(item: ApprovalItem) {
    setPendingId(item.request.id);
    startTransition(async () => {
      const res = await decideLeaveAction({
        requestId: item.request.id,
        action: "approve",
        note: null,
      });
      setPendingId(null);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't approve");
        return;
      }
      toast.success("Approved", {
        description: `${item.requesterName}'s ${LEAVE_TYPE_LABEL[item.request.type]} leave.`,
      });
      setList((cur) => cur.filter((c) => c.request.id !== item.request.id));
    });
  }

  function openReject(item: ApprovalItem) {
    setRejectFor(item);
    setRejectNote("");
  }

  function submitReject() {
    if (!rejectFor) return;
    const item = rejectFor;
    setPendingId(item.request.id);
    startTransition(async () => {
      const res = await decideLeaveAction({
        requestId: item.request.id,
        action: "reject",
        note: rejectNote.trim() || null,
      });
      setPendingId(null);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't reject");
        return;
      }
      toast.success("Rejected", {
        description: `${item.requesterName}'s leave was rejected.`,
      });
      setList((cur) => cur.filter((c) => c.request.id !== item.request.id));
      setRejectFor(null);
    });
  }

  if (list.length === 0) {
    return (
      <Card>
        <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
          You handled everything in the queue. Nice.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {list.map((it) => {
          const isPending = pendingId === it.request.id;
          const range =
            it.request.from_date === it.request.to_date
              ? longDate(it.request.from_date)
              : `${longDate(it.request.from_date)} → ${longDate(it.request.to_date)}`;
          return (
            <Card key={it.request.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">
                      {it.requesterName}
                      {it.requesterTeam && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {it.requesterTeam}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {LEAVE_TYPE_LABEL[it.request.type]} leave · {range}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {it.escalated && (
                      <Badge variant="destructive">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Escalated
                      </Badge>
                    )}
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                </div>

                {it.request.reason && (
                  <p className="rounded-md border bg-muted/30 p-3 text-sm text-foreground">
                    {it.request.reason}
                  </p>
                )}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => openReject(it)}
                    disabled={isPending}
                  >
                    Reject
                  </Button>
                  <Button onClick={() => approve(it)} disabled={isPending}>
                    {isPending ? "Working…" : "Approve"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!rejectFor} onOpenChange={(v) => !v && setRejectFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject leave request</DialogTitle>
            <DialogDescription>
              {rejectFor &&
                `${rejectFor.requesterName} — ${LEAVE_TYPE_LABEL[rejectFor.request.type]} leave (${rejectFor.request.from_date} → ${rejectFor.request.to_date}).`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">Reason (sent to the requester)</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              maxLength={500}
              placeholder="Brief explanation"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitReject}
              disabled={pendingId === rejectFor?.request.id}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
