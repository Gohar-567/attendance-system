import { TopBar } from "@/components/topbar";
import { MonthlyReport } from "@/components/admin/monthly-report";
import { requireAdminEmployee } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMonthlySummary } from "@/lib/admin/monthly-report";
import { todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ month?: string; team?: string }>;
}

export default async function MonthlyReportPage({ searchParams }: PageProps) {
  await requireAdminEmployee({ kind: "hr_or_admin" });
  const sp = await searchParams;

  const monthISO = sp.month
    ? `${sp.month}-01`
    : todayISO().slice(0, 7) + "-01";
  const teamFilter = sp.team && sp.team !== "all" ? sp.team : null;

  const admin = createAdminClient();
  const { data: teamRows } = await admin
    .from("teams")
    .select("id, name")
    .order("name");
  const teams = (teamRows ?? []) as { id: string; name: string }[];

  const { rows, kpis } = await fetchMonthlySummary({
    monthISO,
    teamId: teamFilter,
  });

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Monthly report
          </h1>
          <p className="text-sm text-muted-foreground">
            Per-employee attendance for the selected month. Outliers
            highlighted automatically.
          </p>
        </div>

        <MonthlyReport
          monthISO={monthISO}
          teams={teams}
          activeTeamId={teamFilter}
          rows={rows}
          kpis={kpis}
        />
      </main>
    </div>
  );
}
