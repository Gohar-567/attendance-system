import { TopBar } from "@/components/topbar";
import { HoursOverview } from "@/components/admin/hours-overview";
import { requireAdminEmployee } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchHoursOverview,
  resolveRange,
} from "@/lib/admin/hours";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    team?: string;
    range?: string;
    from?: string;
    to?: string;
    sort?: string;
    dir?: string;
  }>;
}

const SORTABLE = new Set([
  "full_name",
  "team_name",
  "hours_today",
  "hours_week",
  "hours_month",
  "avg_hours_per_day",
  "days_worked_month",
]);

export default async function HoursOverviewPage({ searchParams }: PageProps) {
  await requireAdminEmployee({ kind: "hr_or_admin" });
  const sp = await searchParams;

  const teamFilter = sp.team && sp.team !== "all" ? sp.team : null;
  const range = resolveRange({ range: sp.range, from: sp.from, to: sp.to });

  const admin = createAdminClient();
  const { data: teamRows } = await admin
    .from("teams")
    .select("id, name")
    .order("name");
  const teams = (teamRows ?? []) as { id: string; name: string }[];

  const { rows } = await fetchHoursOverview({
    teamId: teamFilter,
    fromISO: range.fromISO,
    toISO: range.toISO,
  });

  // Server-side sort so the URL is the source of truth.
  const sortKey = SORTABLE.has(sp.sort ?? "") ? sp.sort! : "full_name";
  const dir: "asc" | "desc" = sp.dir === "desc" ? "desc" : "asc";
  const sorted = [...rows].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey] ?? null;
    const bv = (b as unknown as Record<string, unknown>)[sortKey] ?? null;
    if (av == null && bv == null) return 0;
    if (av == null) return dir === "asc" ? 1 : -1;
    if (bv == null) return dir === "asc" ? -1 : 1;
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }
    return dir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Hours overview
          </h1>
          <p className="text-sm text-muted-foreground">
            Per-employee work hours. Range picker scopes the Excel export.
          </p>
        </div>
        <HoursOverview
          rows={sorted}
          teams={teams}
          activeTeamId={teamFilter}
          range={range}
          sort={{ key: sortKey, dir }}
        />
      </main>
    </div>
  );
}
