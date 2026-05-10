import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ParserStats24h } from "@/lib/admin/parser-stats";

export function ParserStatsCard({ stats }: { stats: ParserStats24h }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight">
            Slack auto-log · last 24h
          </h3>
          <Link
            href="/admin/parser-log"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            View all
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Auto-logged" value={stats.auto_logged} tone="default" />
          <Stat
            label="Awaiting confirm"
            value={stats.awaiting_confirm}
            tone="muted"
          />
          <Stat label="Failed" value={stats.failed} tone="destructive" />
          <Stat
            label="Slash command"
            value={stats.slash_command}
            tone="muted"
          />
        </div>

        <div className="text-xs text-muted-foreground">
          {stats.total} message{stats.total === 1 ? "" : "s"} processed.
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "muted" | "destructive";
}) {
  const variant =
    tone === "destructive"
      ? "destructive"
      : tone === "default"
        ? "default"
        : "secondary";
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <Badge variant={variant} className="hidden sm:inline-flex">
          {value === 0 ? "—" : value === 1 ? "1 msg" : `${value} msgs`}
        </Badge>
      </div>
    </div>
  );
}
