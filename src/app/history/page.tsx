import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { HistoryTable } from "@/components/history/history-table";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  type AttendanceLog,
  type AttendanceType,
} from "@/lib/attendance";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: employee } = await supabase
    .from("employees")
    .select(
      `id, full_name,
       team:teams!team_id ( id, name )`,
    )
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      full_name: string;
      team: { id: string; name: string } | null;
    }>();

  const { data: logsData } = await supabase
    .from("attendance_logs")
    .select(
      "id, employee_id, date, type, half, reason, status, source, slack_message_ts, created_by, created_at, updated_at",
    )
    .eq("employee_id", user.id)
    .order("date", { ascending: false });

  const logs = (logsData ?? []) as AttendanceLog[];

  const totals: Record<AttendanceType | "total", number> = {
    total: logs.length,
    present: 0,
    wfh: 0,
    ewd: 0,
    half_leave: 0,
    full_leave: 0,
    sick: 0,
    holiday: 0,
  };
  for (const l of logs) totals[l.type]++;

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        fullName={employee?.full_name ?? "You"}
        teamName={employee?.team?.name ?? null}
        showHistoryLink={false}
      />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">My history</h1>
          <p className="text-sm text-muted-foreground">
            Every attendance entry, ever. Filter by type or search a reason.
          </p>
        </div>

        {logs.length === 0 ? (
          <Card>
            <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
              No attendance entries yet. They&apos;ll show up here as soon as
              you mark a day or post in #attendance.
            </CardContent>
          </Card>
        ) : (
          <HistoryTable logs={logs} totals={totals} />
        )}
      </main>
    </div>
  );
}
