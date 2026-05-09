// All dates in this app are plain YYYY-MM-DD strings keyed in the team's
// local timezone (Pakistan, UTC+5). Postgres stores them as DATE so timezone
// doesn't enter the picture for the data layer; we just need consistent
// formatters and a month-grid generator for the calendar.

export const TEAM_TIMEZONE = "Asia/Karachi";

/** YYYY-MM-DD for a given Date in TEAM_TIMEZONE. */
export function toISODate(d: Date, tz: string = TEAM_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${day}`;
}

/** Today's YYYY-MM-DD in the team timezone. */
export function todayISO(): string {
  return toISODate(new Date());
}

/** First day of the calendar month for a given ISO date (YYYY-MM-01). */
export function firstOfMonthISO(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

/** Last day of the calendar month for a given ISO date (YYYY-MM-DD). */
export function lastOfMonthISO(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  // Date(y, m, 0) gives last day of month m (1-indexed input means previous-month-last-day for m=1).
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** "May 2026" style label for an ISO date. */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Day-of-week for an ISO date (0 = Sunday, 1 = Monday, ... 6 = Saturday). */
export function dowOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(iso: string): boolean {
  const dow = dowOf(iso);
  return dow === 0 || dow === 6;
}

/**
 * Generate a 6×7 calendar grid covering the month containing `iso`,
 * starting from Monday. Each cell is a YYYY-MM-DD date string.
 *
 * Days outside the target month are still real dates (so we render them
 * faded). Returns 42 cells.
 */
export function monthGrid(iso: string): { date: string; inMonth: boolean }[] {
  const [y, m] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  // Make Monday = 0, Sunday = 6
  const startOffset = (first.getUTCDay() + 6) % 7;
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1 - startOffset + i));
    const iso2 = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    cells.push({ date: iso2, inMonth: d.getUTCMonth() === m - 1 });
  }
  return cells;
}

/** "Sat, May 9, 2026" */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "May 9" */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
