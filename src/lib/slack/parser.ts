import type { AttendanceHalf, AttendanceType } from "@/lib/attendance";

/** Confidence at or above which we auto-log an attendance row. */
export const AUTO_LOG_THRESHOLD = 0.85;

export type ParseOutcome =
  | {
      kind: "match";
      type: AttendanceType;
      half: AttendanceHalf;
      confidence: number;
      /** Stable identifier for the matched rule, surfaced in /admin/parser-log. */
      name: string;
      matched: string;
    }
  | {
      /** Message was a deliberate non-event (checkout, signing off). Caller
       *  should drop it on the floor — no log, no DM, no reaction. */
      kind: "ignore";
      name: string;
    }
  | { kind: "none" };

/**
 * Patterns the bot deliberately ignores. Listed before the "match" patterns
 * because some — like "checking out" — would otherwise hit the broader
 * present/checkin family.
 */
const IGNORE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "ignore_checking_out", re: /\bchecking out\b/i },
  { name: "ignore_check_out", re: /\bcheck[\s-]?out\b/i },
  { name: "ignore_signing_off", re: /\bsign(ing)?[\s-]?off\b/i },
];

/**
 * Pattern table from BUILD_MANIFEST.md §6 plus the checkin/present family.
 * Order matters — first match wins. More-specific phrases are listed before
 * more-generic ones, and ambiguous single-word forms sit at the end with a
 * sub-threshold confidence so the bot DMs the user to clarify via /attendance.
 */
const PATTERNS: {
  name: string;
  re: RegExp;
  type: AttendanceType;
  half: AttendanceHalf;
  confidence: number;
}[] = [
  // ------- Half day (specific halves before the generic) -------
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

  // ------- WFH / EWD -------
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

  // ------- Sick (full day) -------
  {
    name: "sick_basic",
    re: /\b(sick today|not feeling well|feeling unwell|food poisoning)\b/i,
    type: "sick",
    half: "full",
    confidence: 0.85,
  },

  // ------- Full leave (sub-threshold; will DM for /attendance) -------
  {
    name: "full_leave_basic",
    re: /\b(on leave|taking leave|casual leave|annual leave)\b/i,
    type: "full_leave",
    half: "full",
    confidence: 0.8,
  },

  // ------- Present / checkin family -------
  // "checkin 9am" / "check-in at 9:30" — checkin word + a digit anywhere
  // after it. Time itself is not stored (we track days, not hours).
  {
    name: "present_checkin_with_time",
    re: /\bcheck[\s-]?in\b[^\n]*\d/i,
    type: "present",
    half: "full",
    confidence: 0.92,
  },
  // "in at 9:30" / "in at 10am"
  {
    name: "present_in_at_time",
    re: /\bin at\s+\d/i,
    type: "present",
    half: "full",
    confidence: 0.92,
  },
  // "checkin", "check in", "check-in"
  {
    name: "present_checkin",
    re: /\bcheck[\s-]?in\b/i,
    type: "present",
    half: "full",
    confidence: 0.92,
  },
  // "checking in"
  {
    name: "present_checking_in",
    re: /\bchecking in\b/i,
    type: "present",
    half: "full",
    confidence: 0.92,
  },
  // "at office", "in office"
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

  // ------- Ambiguous single-word forms (sub-threshold → bot DMs) -------
  // Anchored to the trimmed message so they only fire when the user wrote
  // exactly the word (with optional trailing punctuation/emoji).
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

export function parseMessage(text: string): ParseOutcome {
  const t = text.trim();

  // Ignore patterns short-circuit. We test these first so a message like
  // "checking out for the day" never falls through to the present family.
  for (const ig of IGNORE_PATTERNS) {
    if (ig.re.test(t)) return { kind: "ignore", name: ig.name };
  }

  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (m) {
      return {
        kind: "match",
        type: p.type,
        half: p.half,
        confidence: p.confidence,
        name: p.name,
        matched: m[0],
      };
    }
  }
  return { kind: "none" };
}
