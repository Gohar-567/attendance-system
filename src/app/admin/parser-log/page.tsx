import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ParseLogRow {
  id: string;
  slack_user_id: string;
  slack_channel_id: string;
  slack_message_ts: string;
  raw_text: string;
  method: "regex" | "claude_api" | "slash_command" | "failed";
  parsed_type: string | null;
  parsed_half: string | null;
  parsed_date: string | null;
  /**
   * For regex matches this stores the pattern name (e.g. `present_checkin`)
   * so HR can spot which rule fired. For slash_command rows it stores the
   * user-typed reason. Disambiguate by `method`.
   */
  parsed_reason: string | null;
  confidence: number | null;
  attendance_log_id: string | null;
  created_at: string;
}

export default async function ParserLogPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("employees")
    .select(`id, full_name, role, team:teams!team_id ( id, name )`)
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      full_name: string;
      role: string;
      team: { id: string; name: string } | null;
    }>();

  if (!me || (me.role !== "hr" && me.role !== "admin")) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar fullName={me?.full_name ?? "You"} teamName={me?.team?.name ?? null} />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <Card>
            <CardContent className="space-y-2 p-6">
              <h2 className="text-lg font-semibold tracking-tight">
                HR only
              </h2>
              <p className="text-sm text-muted-foreground">
                The parser log is restricted to HR and admin roles. Ask HR if
                you need access.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // RLS policy `parse_log_hr_select` lets HR/admin read; we use the
  // authenticated client so the policy enforces the role check.
  const { data: rows } = await supabase
    .from("slack_parse_log")
    .select(
      "id, slack_user_id, slack_channel_id, slack_message_ts, raw_text, method, parsed_type, parsed_half, parsed_date, parsed_reason, confidence, attendance_log_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const logs = (rows ?? []) as ParseLogRow[];

  return (
    <div className="min-h-screen bg-background">
      <TopBar fullName={me.full_name} teamName={me.team?.name ?? null} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Parser log</h1>
          <p className="text-sm text-muted-foreground">
            Last 50 messages the bot processed. Use this to spot patterns the
            regex misses and add to the table in <code>src/lib/slack/parser.ts</code>.
          </p>
        </div>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Pattern</th>
                  <th className="px-3 py-2 font-medium">Conf.</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Raw text</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-12 text-center text-sm text-muted-foreground"
                    >
                      No parse-log rows yet. Post in #attendance to populate.
                    </td>
                  </tr>
                ) : (
                  logs.map((r) => <ParseRow key={r.id} row={r} />)
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function ParseRow({ row }: { row: ParseLogRow }) {
  const status = row.attendance_log_id
    ? { label: "logged", variant: "default" as const }
    : row.method === "failed"
      ? { label: "failed", variant: "destructive" as const }
      : { label: "skipped", variant: "secondary" as const };

  return (
    <tr className="border-t align-top">
      <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">
        {new Date(row.created_at).toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
        {row.slack_user_id}
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline" className="capitalize">
          {row.method.replace("_", " ")}
        </Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-2 capitalize">
        {row.parsed_type ? (
          <>
            {row.parsed_type.replace("_", " ")}
            {row.parsed_half && row.parsed_half !== "full" && (
              <span className="text-muted-foreground">
                {" "}
                · {row.parsed_half.replace("_", " ")}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
        {row.parsed_reason ?? "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {row.confidence != null ? row.confidence.toFixed(2) : "—"}
      </td>
      <td className="px-3 py-2">
        <Badge variant={status.variant}>{status.label}</Badge>
      </td>
      <td className="px-3 py-2">
        <div className="max-w-xl text-sm text-foreground">{row.raw_text}</div>
      </td>
    </tr>
  );
}
