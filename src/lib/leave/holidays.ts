import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the set of holiday ISO dates that fall within [fromISO, toISO].
 * Optional holidays count too (the team treats them as non-working).
 */
export async function fetchHolidaySet(
  supabase: SupabaseClient,
  fromISO: string,
  toISO: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("holidays")
    .select("date")
    .gte("date", fromISO)
    .lte("date", toISO);
  return new Set((data ?? []).map((r: { date: string }) => r.date));
}
