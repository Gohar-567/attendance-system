import type { AttendanceHalf, AttendanceType } from "@/lib/attendance";
import { extractTime } from "@/lib/time";

/** Confidence at or above which we auto-log an attendance row. */
export const AUTO_LOG_THRESHOLD = 0.85;

/**
 * What the events handler should do with the parse result.
 *
 *   - "checkin"   → set checkin_time (from `time` or NOW) on today's row
 *   - "checkout"  → set checkout_time on today's row; refuse if there's
 *                   no row yet
 *   - "info_only" → set type/half on today's row; don't touch times
 *
 * For a "checkin" outcome `type` may also be set when the message
 * implied a non-default type (e.g. "wfh 9:30am" → type=wfh + checkin).
 */
export type ParseIntent = "checkin" | "checkout" | "info_only";

export type ParseOutcome =
  | {
      kind: "match";
      intent: ParseIntent;
      type?: AttendanceType;
      half?: AttendanceHalf;
      /** TIMETZ "HH:MM:SS+05" if the message contained a time. */
      time?: string;
      confidence: number;
      name: string;
      matched: string;
    }
  | { kind: "none" };

// ---- Pattern catalogues --------------------------------------------

/**
 * Explicit checkout signals — message means "I'm leaving for the day."
 * These run before type/checkin patterns so "checking out for the day"
 * isn't mistaken for "checking in".
 */
const CHECKOUT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "checkout_done_for_day", re: /\bdone for (?:the )?day\b/i },
  { name: "checkout_signing_off", re: /\bsign(?:ing)?[\s-]?off\b/i },
  { name: "checkout_checking_out", re: /\bchecking out\b/i },
  { name: "checkout_check_out", re: /\bcheck[\s-]?out\b/i },
  { name: "checkout_clocking_out", re: /\bclock(?:ing)?[\s-]?out\b/i },
  { name: "checkout_out_at", re: /\bout at\s+\d/i },
];

/**
 * Explicit check-in signals. They only need a checkin keyword to fire —
 * any time appearing in the same message is treated as checkin_time.
 */
const CHECKIN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "checkin_clocking_in", re: /\bclock(?:ing)?[\s-]?in\b/i },
  { name: "checkin_started_at", re: /\bstarted at\s+\d/i },
  { name: "checkin_in_at_time", re: /\bin at\s+\d/i },
  { name: "checkin_checking_in", re: /\bchecking in\b/i },
  { name: "checkin_check_in", re: /\bcheck[\s-]?in\b/i },
];

/**
 * Type patterns from manifest §6 plus the present family from Phase 7's
 * earlier addition. In priority order — more-specific first. Returning
 * a type doesn't itself imply a checkin; the caller decides based on
 * whether a time / checkin-keyword is also present.
 */
const TYPE_PATTERNS: {
  name: string;
  re: RegExp;
  type: AttendanceType;
  half: AttendanceHalf;
  confidence: number;
}[] = [
  // Half-leave (specific halves before generic).
  {
    name: "half_first_morning_off",
    re: /\b(morning off|first half off|first half leave)\b/i,
    type: "half_leave",
    half: "first_half",
    confidence: 0.9,
  },
  {
    name: "half_second_afternoon_off",
    re: /\b(afternoon off|second half off|second half leave)\b/i,
    type: "half_leave",
    half: "second_half",
    confidence: 0.9,
  },
  {
    name: "half_day_generic",
    re: /\b(half day|half leave)\b|\b1\/2 day\b/i,
    type: "half_leave",
    half: "full",
    confidence: 0.85,
  },
  // WFH / EWD.
  {
    name: "wfh_basic",
    re: /\b(wfh|working from home)\b/i,
    type: "wfh",
    half: "full",
    confidence: 0.95,
  },
  {
    name: "ewd_basic",
    re: /\b(ewd|client visit|at client|external work)\b/i,
    type: "ewd",
    half: "full",
    confidence: 0.9,
  },
  // Sick (full day).
  {
    name: "sick_basic",
    re: /\b(sick today|not feeling well|feeling unwell|food poisoning)\b/i,
    type: "sick",
    half: "full",
    confidence: 0.85,
  },
  // Full leave (sub-threshold; will DM for /attendance).
  {
    name: "full_leave_basic",
    re: /\b(on leave|taking leave|casual leave|annual leave)\b/i,
    type: "full_leave",
    half: "full",
    confidence: 0.8,
  },
  // Present family — anything implying physical attendance.
  {
    name: "present_at_office",
    re: /\b(at|in) office\b/i,
    type: "present",
    half: "full",
    confidence: 0.92,
  },
  {
    name: "present_online",
    re: /\bonline\b/i,
    type: "present",
    half: "full",
    confidence: 0.9,
  },
  // Ambiguous single-word "in" / "here" — sub-threshold on purpose.
  {
    name: "present_in_alone",
    re: /^in[\s.!?]*$/i,
    type: "present",
    half: "full",
    confidence: 0.75,
  },
  {
    name: "present_here_alone",
    re: /^here[\s.!?]*$/i,
    type: "present",
    half: "full",
    confidence: 0.75,
  },
];

function firstMatch<T extends { re: RegExp }>(
  patterns: T[],
  text: string,
): { entry: T; matched: string } | null {
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) return { entry: p, matched: m[0] };
  }
  return null;
}

export function parseMessage(text: string): ParseOutcome {
  const t = text.trim();
  const time = extractTime(t);

  // 1. Checkout signals — these win over checkin patterns even if the
  //    message also contains "in" somewhere (e.g. "checkin morning,
  //    checking out 6pm" — uncommon but defensible).
  const checkout = firstMatch(CHECKOUT_PATTERNS, t);
  if (checkout) {
    return {
      kind: "match",
      intent: "checkout",
      time: time ?? undefined,
      confidence: 0.95,
      name: checkout.entry.name,
      matched: checkout.matched,
    };
  }

  // 2. Type detection (informs intent below).
  const typeHit = firstMatch(TYPE_PATTERNS, t);

  // 3. Explicit checkin keyword.
  const checkin = firstMatch(CHECKIN_PATTERNS, t);

  if (checkin) {
    return {
      kind: "match",
      intent: "checkin",
      type: typeHit?.entry.type ?? "present",
      half: typeHit?.entry.half ?? "full",
      time: time ?? undefined,
      confidence: Math.max(0.92, typeHit?.entry.confidence ?? 0),
      name: checkin.entry.name,
      matched: checkin.matched,
    };
  }

  if (typeHit) {
    // No explicit checkin word — but if a time appears, treat it as a
    // checkin signal too ("WFH 9:30am" → set checkin_time).
    const intent: ParseIntent = time ? "checkin" : "info_only";
    return {
      kind: "match",
      intent,
      type: typeHit.entry.type,
      half: typeHit.entry.half,
      time: intent === "checkin" ? time ?? undefined : undefined,
      confidence: typeHit.entry.confidence,
      name: typeHit.entry.name,
      matched: typeHit.matched,
    };
  }

  return { kind: "none" };
}
