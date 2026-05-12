"use client";

import { LogIn, LogOut } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  checkInNowAction,
  checkOutNowAction,
} from "@/app/actions/attendance";

interface CheckInOutControlsProps {
  state: "needs_checkin" | "needs_checkout" | "done";
}

/** Buttons rendered inside the TodayBanner. State drives which button (if
 *  any) shows up; the server actions handle the upsert + revalidation. */
export function CheckInOutControls({ state }: CheckInOutControlsProps) {
  const [pending, startTransition] = useTransition();

  function handleCheckIn() {
    startTransition(async () => {
      const res = await checkInNowAction();
      if (!res.ok) toast.error(res.error ?? "Couldn't check in");
      else toast.success("Checked in");
    });
  }

  function handleCheckOut() {
    startTransition(async () => {
      const res = await checkOutNowAction();
      if (!res.ok) toast.error(res.error ?? "Couldn't check out");
      else toast.success("Checked out");
    });
  }

  if (state === "needs_checkin") {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={handleCheckIn}
        disabled={pending}
        className="bg-white text-blue-700 hover:bg-white/90"
      >
        <LogIn className="h-4 w-4" />
        {pending ? "Checking in…" : "Check in now"}
      </Button>
    );
  }

  if (state === "needs_checkout") {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={handleCheckOut}
        disabled={pending}
        className="bg-white/15 text-white hover:bg-white/25 border border-white/30"
      >
        <LogOut className="h-4 w-4" />
        {pending ? "Checking out…" : "Check out"}
      </Button>
    );
  }

  return null;
}
