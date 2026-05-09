"use client";

import { useState, useTransition } from "react";
import { Home, Pause, Plane } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logWfhTodayAction } from "@/app/actions/attendance";

export function QuickActions({ todayMarked }: { todayMarked: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleWfh() {
    setError(null);
    startTransition(async () => {
      const res = await logWfhTodayAction();
      if (!res.ok) setError(res.error ?? "Failed to log WFH");
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        <Button
          onClick={handleWfh}
          disabled={pending}
          className="w-full"
        >
          <Home className="h-4 w-4" />
          {todayMarked ? "Update to WFH" : "Log WFH"}
        </Button>

        <Button
          variant="outline"
          className="w-full"
          disabled
          title="Coming in Phase 4"
        >
          <Pause className="h-4 w-4" />
          Half day
        </Button>

        <Button
          variant="outline"
          className="w-full"
          disabled
          title="Coming in Phase 4"
        >
          <Plane className="h-4 w-4" />
          Request leave
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
