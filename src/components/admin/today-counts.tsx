import { Card, CardContent } from "@/components/ui/card";
import type { TodayCounts } from "@/lib/admin/today";

const TILES: {
  key: keyof Omit<TodayCounts, "total">;
  label: string;
  ring: string;
}[] = [
  { key: "present", label: "Present", ring: "ring-emerald-500/40" },
  { key: "wfh", label: "WFH", ring: "ring-blue-500/40" },
  { key: "half", label: "Half", ring: "ring-amber-500/50" },
  { key: "on_leave", label: "On leave", ring: "ring-red-500/40" },
  { key: "unmarked", label: "Unmarked", ring: "ring-border" },
];

export function TodayCountsStrip({ counts }: { counts: TodayCounts }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
      {TILES.map((t) => (
        <Card key={t.key} className={`ring-1 ${t.ring}`}>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {counts[t.key]}
            </div>
            <div className="text-xs text-muted-foreground">
              of {counts.total}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
