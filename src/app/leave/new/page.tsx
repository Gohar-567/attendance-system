import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { LeaveForm } from "@/components/leave/leave-form";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/date";
import type { BalanceRow } from "@/lib/attendance";

export const dynamic = "force-dynamic";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export default async function NewLeavePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = todayISO();
  const horizon = new Date(Date.now() + NINETY_DAYS_MS)
    .toISOString()
    .slice(0, 10);

  const { data: me } = await supabase
    .from("employees")
    .select(`id, full_name, team_id, team:teams!team_id ( id, name )`)
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      full_name: string;
      team_id: string | null;
      team: { id: string; name: string } | null;
    }>();
  if (!me) redirect("/");

  const [balanceRes, holidaysRes, teamLogsRes] = await Promise.all([
    supabase
      .from("v_employee_balances")
      .select(
        "employee_id, full_name, casual_allowance, casual_used, sick_allowance, sick_used, annual_allowance, annual_used",
      )
      .eq("employee_id", user.id)
      .maybeSingle<BalanceRow>(),
    supabase
      .from("holidays")
      .select("date, name")
      .gte("date", today)
      .lte("date", horizon),
    me.team_id
      ? supabase
          .from("attendance_logs")
          .select("employee_id, date, type, employee:employees!employee_id ( id, full_name, team_id )")
          .in("type", ["full_leave", "sick"])
          .gte("date", today)
          .lte("date", horizon)
      : Promise.resolve({ data: [] }),
  ]);

  const balance = balanceRes.data ?? null;
  const holidays = (holidaysRes.data ?? []) as { date: string; name: string }[];
  type RawTeamLog = {
    employee_id: string;
    date: string;
    type: string;
    employee: { id: string; full_name: string; team_id: string | null } | null;
  };
  const teamLogs = ((teamLogsRes.data as RawTeamLog[] | null) ?? []).filter(
    (l) => l.employee_id !== user.id && l.employee?.team_id === me.team_id,
  );

  return (
    <div className="min-h-screen bg-background">
      <TopBar fullName={me.full_name} teamName={me.team?.name ?? null} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Request leave
          </h1>
          <p className="text-sm text-muted-foreground">
            Full leaves need approval. WFH, half day, and EWD don&apos;t — log
            those from the dashboard or in #attendance.
          </p>
        </div>

        <LeaveForm
          balance={balance}
          holidays={holidays}
          teamLeaves={teamLogs.map((l) => ({
            employee_id: l.employee_id,
            full_name: l.employee?.full_name ?? "Teammate",
            date: l.date,
            type: l.type,
          }))}
          today={today}
        />
      </main>
    </div>
  );
}
