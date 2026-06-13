import { firstOfMonthISO, todayISO } from "@/lib/date";

/** Months the calendar will refuse to load further back than. Matches the
 *  chevron disable rule in MonthCalendar so a manually-typed ?month= URL
 *  can't bypass the limit. */
const MAX_LOOKBACK_MONTHS = 6;

function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Read the optional ?month=YYYY-MM query param off a page's searchParams
 * and return the canonical first-of-month ISO date the dashboard /
 * employee calendar should load.
 *
 *  - Falls back to the current month when the param is missing or
 *    malformed.
 *  - Clamps to today's month when someone tries to look at a future
 *    month.
 *  - Clamps to 6 months back when someone tries to look further than
 *    that — mirrors the chevron disable rule so URL fiddling can't
 *    bypass it.
 */
export function resolveMonthParam(raw: string | undefined | null): string {
  const today = todayISO();
  const currentMonth = firstOfMonthISO(today);
  const minMonth = addMonths(currentMonth, -MAX_LOOKBACK_MONTHS);

  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return currentMonth;
  const candidate = `${raw}-01`;
  if (candidate > currentMonth) return currentMonth;
  if (candidate < minMonth) return minMonth;
  return candidate;
}
