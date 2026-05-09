import type { AttendanceHalf, AttendanceType } from "@/lib/attendance";

/** Confidence at or above which we auto-log an attendance row. */
export const AUTO_LOG_THRESHOLD = 0.85;

export interface ParseResult {
  type: AttendanceType;
  half: AttendanceHalf;
  confidence: number;
  matched: string;
}

/**
 * Pattern table from BUILD_MANIFEST.md §6, in priority order.
 * First match wins. Patterns are evaluated against the trimmed message text.
 *
 * Specific phrases (e.g. "morning off", "afternoon off") are listed before
 * the generic "half day" so they win when both could match.
 */
const PATTERNS: {
  re: RegExp;
  type: AttendanceType;
  half: AttendanceHalf;
  confidence: number;
}[] = [
  {
    re: /\b(morning off|first half off|first half leave)\b/i,
    type: "half_leave",
    half: "first_half",
    confidence: 0.9,
  },
  {
    re: /\b(afternoon off|second half off|second half leave)\b/i,
    type: "half_leave",
    half: "second_half",
    confidence: 0.9,
  },
  {
    re: /\b(half day|half leave)\b|\b1\/2 day\b/i,
    type: "half_leave",
    half: "full",
    confidence: 0.85,
  },
  {
    re: /\b(wfh|working from home)\b/i,
    type: "wfh",
    half: "full",
    confidence: 0.95,
  },
  {
    re: /\b(ewd|client visit|at client|external work)\b/i,
    type: "ewd",
    half: "full",
    confidence: 0.9,
  },
  {
    re: /\b(sick today|not feeling well|feeling unwell|food poisoning)\b/i,
    type: "sick",
    half: "full",
    confidence: 0.85,
  },
  {
    re: /\b(on leave|taking leave|casual leave|annual leave)\b/i,
    type: "full_leave",
    half: "full",
    confidence: 0.8,
  },
];

/**
 * Run the regex parser against a Slack message body.
 * Returns null if no pattern matched at all (caller logs as method='failed').
 */
export function parseMessage(text: string): ParseResult | null {
  const t = text.trim();
  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (m) {
      return {
        type: p.type,
        half: p.half,
        confidence: p.confidence,
        matched: m[0],
      };
    }
  }
  return null;
}
