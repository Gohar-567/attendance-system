/**
 * Time helpers for hours tracking (Phase 7C).
 *
 * Times are stored as plain Postgres TIME ("HH:MM:SS"), serialized
 * the same way over the wire. The schema's `date` column provides the
 * calendar context, and the whole app operates in Asia/Karachi —
 * there's no per-row timezone to track. TIMETZ was the original
 * choice but Postgres has no `time with time zone - time with time zone`
 * subtraction operator, which broke the compute_total_hours trigger.
 *
 * The parser below is forgiving about the offset: any trailing "+05" /
 * "+05:00" is ignored, so historical TIMETZ rows still render correctly.
 */

export const PK_TZ = "Asia/Karachi";

/** Current local time-of-day in Pakistan as a Postgres TIME string. */
export function currentKarachiTime(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: PK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  const s = parts.find((p) => p.type === "second")?.value ?? "00";
  // 24h Intl can produce "24:NN" at midnight in some engines; normalise.
  const hh = h === "24" ? "00" : h;
  return `${hh}:${m}:${s}`;
}

/**
 * Parse a Postgres TIME string into hour, minute, second components.
 *   Plain TIME:  "09:30:00", "09:30"
 *   Legacy TIMETZ: "09:30:00+05", "09:30:00+05:00", "09:30:00.000+05"
 * The trailing offset is ignored — Pakistan-only system.
 */
function splitTimeStr(s: string): { h: number; m: number; sec: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  return {
    h: Number(m[1]),
    m: Number(m[2]),
    sec: Number(m[3] ?? "0"),
  };
}

/** "09:30:00" → "9:30 AM" */
export function formatTimeShort(t: string | null | undefined): string {
  if (!t) return "—";
  const parts = splitTimeStr(t);
  if (!parts) return t;
  const { h, m } = parts;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "09:30:00" → "09:30" — value usable in <input type="time">. */
export function toHHMM(t: string | null | undefined): string {
  if (!t) return "";
  const parts = splitTimeStr(t);
  if (!parts) return "";
  return `${String(parts.h).padStart(2, "0")}:${String(parts.m).padStart(2, "0")}`;
}

/** "09:30" or "9:30" → "09:30:00". */
export function fromHHMM(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

/**
 * Format a numeric hour count for display.
 *   8.7 → "8.7"
 *   4.0 → "4"
 *   null/undefined → "—"
 */
export function formatHours(h: number | null | undefined, withUnit = false): string {
  if (h == null) return "—";
  const rounded = Math.round(h * 10) / 10;
  const trimmed = Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(1)}`;
  return withUnit ? `${trimmed} hrs` : trimmed;
}

/**
 * Live total-hours preview for the Day Detail edit form.
 * Returns the (checkout - checkin) duration in hours, or null when either
 * end is missing or the range is impossible / longer than 16 hours
 * (mirrors the SQL trigger's clamp).
 */
export function computeHours(
  checkin: string | null,
  checkout: string | null,
): number | null {
  if (!checkin || !checkout) return null;
  const a = splitTimeStr(checkin);
  const b = splitTimeStr(checkout);
  if (!a || !b) return null;
  const aMin = a.h * 60 + a.m;
  const bMin = b.h * 60 + b.m;
  const diff = (bMin - aMin) / 60;
  if (diff < 0 || diff > 16) return null;
  return diff;
}

// ---------------------------------------------------------------------
// Phase 9 — TIMESTAMPTZ (work_sessions) helpers, all in Asia/Karachi.
// ---------------------------------------------------------------------

import { KARACHI_OFFSET, KARACHI_TZ } from "@/lib/business-day";

/** Karachi wall-clock parts for an instant. */
function karachiWallParts(iso: string): {
  date: string;
  hour: string;
  minute: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KARACHI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return { date: `${y}-${m}-${d}`, hour, minute: get("minute") };
}

/** TIMESTAMPTZ ISO → "9:00 AM" in Karachi. */
export function formatInstantTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const { hour, minute } = karachiWallParts(iso);
  const h = Number(hour);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${minute} ${ampm}`;
}

/** TIMESTAMPTZ ISO → "YYYY-MM-DDTHH:MM" for an <input type="datetime-local">
 *  rendered in Karachi wall time. */
export function instantToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const { date, hour, minute } = karachiWallParts(iso);
  return `${date}T${hour}:${minute}`;
}

/** "YYYY-MM-DDTHH:MM" (Karachi wall time) → TIMESTAMPTZ ISO with +05:00. */
export function localInputToInstant(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:00${KARACHI_OFFSET}`;
}

// ---------------------------------------------------------------------
// Slack message time extraction
// ---------------------------------------------------------------------

/**
 * Pull a time out of free-form Slack text.
 *
 * Handles:  "9am" / "9 am" / "9:30am" / "9:30" / "09:30" / "10:30pm" /
 *           "noon" / "midnight" / "0930"
 *
 * Returns a Postgres TIME string ("HH:MM:00") or null when nothing parses.
 *
 * Ambiguity rule (per PHASE_7_DESIGN.md §7C): when the message gives an
 * hour < 8 with NO am/pm marker, assume PM — typo guard for "checkout 6"
 * meaning 6pm.
 */
export function extractTime(text: string): string | null {
  const t = text.toLowerCase();

  if (/\bnoon\b/.test(t)) return "12:00:00";
  if (/\bmidnight\b/.test(t)) return "00:00:00";

  // Match "HH(:MM)? (am|pm)?" — capture three groups: hour, minute (opt),
  // ampm (opt). Allow space between number and meridiem.
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t);
  if (!m) return null;

  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];

  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  if (h > 12 && ampm) return null; // "14pm" is bogus

  if (ampm === "pm" && h < 12) h += 12;
  else if (ampm === "am" && h === 12) h = 0;
  else if (!ampm && h < 8) h += 12; // typo-guard

  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}
