import { createAdminClient } from "@/lib/supabase/admin";

export interface ParserStats24h {
  total: number;
  auto_logged: number; // method='regex' AND attendance_log_id IS NOT NULL
  awaiting_confirm: number; // method='regex' AND attendance_log_id IS NULL (sub-threshold)
  failed: number; // method='failed'
  slash_command: number; // method='slash_command'
}

/**
 * 24-hour rollup for the dashboard's "Slack auto-log" card. Buckets line up
 * with how the events route writes rows (see app/api/slack/events/route.ts).
 */
export async function fetchParserStats24h(): Promise<ParserStats24h> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data } = await admin
    .from("slack_parse_log")
    .select("method, attendance_log_id")
    .gte("created_at", since);

  const stats: ParserStats24h = {
    total: 0,
    auto_logged: 0,
    awaiting_confirm: 0,
    failed: 0,
    slash_command: 0,
  };

  for (const row of data ?? []) {
    stats.total++;
    if (row.method === "failed") stats.failed++;
    else if (row.method === "slash_command") stats.slash_command++;
    else if (row.method === "regex") {
      if (row.attendance_log_id) stats.auto_logged++;
      else stats.awaiting_confirm++;
    }
  }

  return stats;
}
