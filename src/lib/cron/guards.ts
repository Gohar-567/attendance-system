import type { SupabaseClient } from "@supabase/supabase-js";

import { isWeekend } from "@/lib/date";

/**
 * Phase 9 (9E): weekend + holiday skip guard for the reminder crons.
 * The Vercel schedules already restrict to Mon–Fri, but a manual run or a
 * public holiday landing on a weekday must also be skipped so the bot
 * never pings on a non-working day.
 *
 * Returns "weekend" | "holiday" when the run should be skipped, else null.
 */
export async function cronSkipReason(
  admin: SupabaseClient,
  todayISO: string,
): Promise<"weekend" | "holiday" | null> {
  if (isWeekend(todayISO)) return "weekend";
  const { data: hol } = await admin
    .from("holidays")
    .select("date")
    .eq("date", todayISO)
    .maybeSingle();
  return hol ? "holiday" : null;
}
