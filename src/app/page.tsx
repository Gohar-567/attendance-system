import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { TodayBanner } from "@/components/dashboard/today-banner";
import { BalanceCards } from "@/components/dashboard/balance-cards";
import { MonthCalendar } from "@/components/dashboard/month-calendar";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  type AttendanceLog,
  type BalanceRow,
  type Holiday,
} from "@/lib/attendance";
import {
  firstOfMonthISO,
  isWeekend,
  lastOfMonthISO,
  todayISO,
} from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = todayISO();
  const monthStart = firstOfMonthISO(today);
  const monthEnd = lastOfMonthISO(today);

  // Pull employee + team in one round trip.
  const { data: employee } = await supabase
    .from("employees")
    .select(
      `id, full_name, role, slack_user_id, team_id,
       team:teams!team_id ( id, name, lead_id )`,
    )
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      full_name: string;
      role: "employee" | "team_lead" | "hr" | "admin";
      slack_user_id: string | null;
      team_id: string | null;
      team: { id: string; name: string; lead_id: string | null } | null;
    }>();

  if (!employee) {
    // Auth user has no employees row yet (HR hasn't linked them).
    return (
      <UnlinkedShell email={user.email ?? "your account"} />
    );
  }

  // Parallel fetch: month logs, holidays, balance row, total log count, today's log.
  const [logsRes, holidaysRes, balanceRes, totalRes, todayLogRes] =
    await Promise.all([
      supabase
        .from("attendance_logs")
        .select(
          "id, employee_id, date, type, half, reason, status, source, slack_message_ts, created_by, created_at, updated_at",
        )
        .eq("employee_id", user.id)
        .gte("date", monthStart)
        .lte("date", monthEnd)
        .order("date", { ascending: true }),
      supabase
        .from("holidays")
        .select("id, date, name, is_optional")
        .gte("date", monthStart)
        .lte("date", monthEnd),
      supabase
        .from("v_employee_balances")
        .select(
          "employee_id, full_name, casual_allowance, casual_used, sick_allowance, sick_used, annual_allowance, annual_used",
        )
        .eq("employee_id", user.id)
        .maybeSingle<BalanceRow>(),
      supabase
        .from("attendance_logs")
        .select("*", { count: "exact", head: true })
        .eq("employee_id", user.id),
      supabase
        .from("attendance_logs")
        .select(
          "id, employee_id, date, type, half, reason, status, source, slack_message_ts, created_by, created_at, updated_at",
        )
        .eq("employee_id", user.id)
        .eq("date", today)
        .maybeSingle<AttendanceLog>(),
    ]);

  const monthLogs = (logsRes.data ?? []) as AttendanceLog[];
  const holidays = (holidaysRes.data ?? []) as Holiday[];
  const balance = (balanceRes.data ?? null) as BalanceRow | null;
  const lifetimeCount = totalRes.count ?? 0;
  const todayLog = (todayLogRes.data ?? null) as AttendanceLog | null;

  const wfhThisMonth = monthLogs.filter(
    (l) => l.type === "wfh" || l.type === "ewd",
  ).length;
  const todayHoliday =
    holidays.find((h) => h.date === today)?.name ?? null;

  const isFirstTime = lifetimeCount === 0;

  return (
    <div className="min-h-screen bg-background">
      <TopBar />

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
        {isFirstTime ? (
          <>
            <BalanceCards balance={balance} wfhThisMonth={0} />
            <EmptyState
              fullName={employee.full_name}
              slackLinked={!!employee.slack_user_id}
              hasTeam={!!employee.team_id}
            />
          </>
        ) : (
          <>
            <TodayBanner
              todayISO={today}
              log={todayLog}
              isWeekend={isWeekend(today)}
              holidayName={todayHoliday}
            />

            <BalanceCards balance={balance} wfhThisMonth={wfhThisMonth} />

            <Card>
              <CardContent className="space-y-4 p-4 sm:p-6">
                <MonthCalendar
                  monthISO={today}
                  todayISO={today}
                  logs={monthLogs}
                  holidays={holidays.map((h) => ({
                    date: h.date,
                    name: h.name,
                  }))}
                  currentUserId={employee.id}
                  isHr={
                    employee.role === "hr" || employee.role === "admin"
                  }
                />
              </CardContent>
            </Card>

            <QuickActions todayMarked={!!todayLog} />
          </>
        )}
      </main>
    </div>
  );
}

function UnlinkedShell({ email }: { email: string }) {
  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="space-y-2 p-6">
            <h2 className="text-lg font-semibold tracking-tight">
              Your account isn&apos;t linked yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Ask HR to add{" "}
              <span className="font-medium text-foreground">{email}</span> to
              the employees table. Once they do, refresh this page.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
