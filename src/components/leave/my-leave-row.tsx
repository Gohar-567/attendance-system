"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LEAVE_TYPE_LABEL, type LeaveRequest } from "@/lib/leave/types";
import { longDate } from "@/lib/date";
import { cancelOwnLeaveAction } from "@/app/actions/leave";

const STATUS_VARIANT: Record<
  LeaveRequest["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
  cancelled: "outline",
};

export function MyLeaveRow({ request }: { request: LeaveRequest }) {
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  function handleCancel() {
    if (!confirm("Cancel this leave request?")) return;
    startTransition(async () => {
      const res = await cancelOwnLeaveAction(request.id);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't cancel");
        return;
      }
      toast.success("Request cancelled");
      setHidden(true);
    });
  }

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2 font-medium">{LEAVE_TYPE_LABEL[request.type]}</td>
      <td className="px-3 py-2 tabular-nums">
        {request.from_date === request.to_date
          ? longDate(request.from_date)
          : `${longDate(request.from_date)} → ${longDate(request.to_date)}`}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {request.reason ?? "—"}
        {request.decision_note && (
          <div className="mt-1 text-xs italic">
            Note: {request.decision_note}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant={STATUS_VARIANT[request.status]} className="capitalize">
          {request.status}
        </Badge>
      </td>
      <td className="px-3 py-2 text-right">
        {request.status === "pending" && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancel}
            disabled={pending}
          >
            {pending ? "…" : "Cancel"}
          </Button>
        )}
      </td>
    </tr>
  );
}
