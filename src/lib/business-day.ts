/**
 * Phase 9 — canonical business-day logic.
 *
 * The company's "attendance day" is NOT midnight-to-midnight. It runs from
 * 9:00 AM Asia/Karachi to the next day's 8:59:59 AM Asia/Karachi. This is
 * universal — every employee, every session, every report.
 *
 * A timestamp at or after 09:00 Karachi belongs to that calendar date;
 * anything from 00:00–08:59 Karachi is treated as a night-shift worker
 * finishing the *previous* business day, so it rolls back one day.
 *
 * This module is the single source of truth for that rule on the JS side.
 * The identical logic lives in Postgres as `business_date(ts TIMESTAMPTZ)`
 * (see supabase/phase9_multi_session.sql) and drives the GENERATED column
 * `work_sessions.session_date`. Keep the two in lock-step.
 */

export const KARACHI_TZ = "Asia/Karachi";
/** Pakistan has no DST — the offset is a constant +05:00 year-round. */
export const KARACHI_OFFSET = "+05:00";

/** The business-day cutoff hour (inclusive) in Karachi local time. */
export const BUSINESS_DAY_START_HOUR = 9;

/** Max length of a single work session, in hours. Longer = rejected. */
export const MAX_SESSION_HOURS = 16;

/** A prior open session older than this (days) no longer blocks a new
 *  check-in; instead the stale one is tagged source='unclosed' for HR. */
export const OPEN_SESSION_STALE_DAYS = 7;

/** Karachi calendar-date + hour for an instant, as integers/strings. */
function karachiParts(d: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KARACHI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  let h = parts.find((p) => p.type === "hour")!.value;
  // 24h Intl can emit "24" at midnight in some engines — normalise to 0.
  if (h === "24") h = "00";
  return { date: `${y}-${m}-${day}`, hour: Number(h) };
}

/** YYYY-MM-DD minus one day (string-only, no Date drift). */
function minusOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const back = new Date(Date.UTC(y, m - 1, d - 1));
  return back.toISOString().slice(0, 10);
}

/**
 * The business date (YYYY-MM-DD) a timestamp belongs to.
 *
 *   - hour ≥ 9 Karachi → that calendar date
 *   - hour < 9 Karachi → calendar date − 1 day (night-shift finishing
 *     yesterday's business day)
 *
 * Accepts a Date or any value `new Date()` understands (ISO string, etc).
 */
export function businessDate(timestamp: Date | string): string {
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const { date, hour } = karachiParts(d);
  return hour >= BUSINESS_DAY_START_HOUR ? date : minusOneDay(date);
}

/** The business date for *now*. */
export function todayBusinessDate(): string {
  return businessDate(new Date());
}

/**
 * Build a TIMESTAMPTZ-friendly ISO string from a Karachi wall-clock date +
 * time. Used when the parser turns "checkin 9am" into an instant — the
 * employee meant 9am Karachi, which is a fixed +05:00 offset.
 *
 *   karachiInstant("2026-06-21", "09:00:00") → "2026-06-21T09:00:00+05:00"
 */
export function karachiInstant(dateISO: string, timeHHMMSS: string): string {
  const time = timeHHMMSS.length === 5 ? `${timeHHMMSS}:00` : timeHHMMSS;
  return `${dateISO}T${time}${KARACHI_OFFSET}`;
}

/** Duration between two instants in hours (ended − started). */
export function durationHours(startedAt: string, endedAt: string): number {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return ms / 3_600_000;
}

/** Age of an instant relative to now, in hours. */
export function hoursSince(ts: string): number {
  return (Date.now() - new Date(ts).getTime()) / 3_600_000;
}
