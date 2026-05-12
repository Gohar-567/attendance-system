import { isWeekend } from "./date";

export type AttendanceType =
  | "present"
  | "wfh"
  | "ewd"
  | "half_leave"
  | "full_leave"
  | "sick"
  | "holiday";

/** Attendance types employees can pick from the edit / backdate form.
 *  Excludes full_leave (goes through the approval flow) and holiday
 *  (seeded in the holidays table). Lives here rather than in a
 *  "use server" file because Next.js requires those files to export
 *  only async functions. */
export const EDITABLE_TYPES = [
  "present",
  "wfh",
  "ewd",
  "half_leave",
  "sick",
] as const;
export type EditableType = (typeof EDITABLE_TYPES)[number];

export type AttendanceHalf = "full" | "first_half" | "second_half";

export type AttendanceStatus =
  | "auto_logged"
  | "pending"
  | "approved"
  | "rejected"
  | "confirmed";

export type AttendanceSource =
  | "slack"
  | "web"
  | "web_backdated"
  | "slash_command"
  | "hr_manual"
  | "leave_request";

export interface AttendanceLog {
  id: string;
  employee_id: string;
  date: string;
  type: AttendanceType;
  half: AttendanceHalf;
  reason: string | null;
  status: AttendanceStatus;
  source: AttendanceSource;
  slack_message_ts: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Phase 7C: Postgres TIME ("HH:MM:SS") set when the user / bot logged
   *  a check-in for the day; null on leave/holiday days. The whole app
   *  operates in Asia/Karachi so there's no timezone on the column. */
  checkin_time: string | null;
  /** Phase 7C: same shape as checkin_time. */
  checkout_time: string | null;
  /** Phase 7C: computed by the SQL trigger compute_total_hours(). Half
   *  days are forced to 4.0; leave/sick/holiday/invalid ranges → null. */
  total_hours: number | null;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  is_optional: boolean;
}

export interface BalanceRow {
  employee_id: string;
  full_name: string;
  casual_allowance: number;
  casual_used: number;
  sick_allowance: number;
  sick_used: number;
  annual_allowance: number;
  annual_used: number;
}

/** Display label for an attendance type. */
export const TYPE_LABEL: Record<AttendanceType, string> = {
  present: "Present",
  wfh: "Working from home",
  ewd: "External work day",
  half_leave: "Half leave",
  full_leave: "Full leave",
  sick: "Sick",
  holiday: "Holiday",
};

/**
 * Calendar swatch classes per spec:
 *   green = present, blue = WFH/EWD, amber = half, red = full leave/sick,
 *   gray = weekend / holiday, future = dashed border.
 */
export function cellClassesFor(opts: {
  log?: AttendanceLog | null;
  isHoliday?: boolean;
  iso: string;
  todayISO: string;
}): string {
  const { log, isHoliday, iso, todayISO: t } = opts;
  const future = iso > t;
  const isToday = iso === t;
  const ring = isToday ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "";
  const dashed = future ? "border-dashed" : "border-solid";

  let palette: string;

  if (log) {
    switch (log.type) {
      case "present":
        palette = "bg-emerald-500/15 border-emerald-500/40 text-emerald-900 dark:text-emerald-200";
        break;
      case "wfh":
      case "ewd":
        palette = "bg-blue-500/15 border-blue-500/40 text-blue-900 dark:text-blue-200";
        break;
      case "half_leave":
        palette = "bg-amber-500/20 border-amber-500/50 text-amber-900 dark:text-amber-200";
        break;
      case "full_leave":
      case "sick":
        palette = "bg-red-500/15 border-red-500/40 text-red-900 dark:text-red-200";
        break;
      case "holiday":
        palette = "bg-muted border-border text-muted-foreground";
        break;
      default:
        palette = "bg-muted border-border text-muted-foreground";
    }
  } else if (isHoliday || isWeekend(iso)) {
    palette = "bg-muted/60 border-border text-muted-foreground";
  } else if (future) {
    palette = "bg-background border-border text-muted-foreground";
  } else {
    // past working day, no entry
    palette = "bg-background border-border text-muted-foreground";
  }

  return `${palette} ${dashed} ${ring}`.trim();
}

/** Short text rendered inside a cell ("WFH", "L", "½", etc.). */
export function cellGlyph(log?: AttendanceLog | null): string {
  if (!log) return "";
  switch (log.type) {
    case "present":
      return "P";
    case "wfh":
      return "WFH";
    case "ewd":
      return "EWD";
    case "half_leave":
      return log.half === "first_half" ? "½AM" : log.half === "second_half" ? "½PM" : "½";
    case "full_leave":
      return "L";
    case "sick":
      return "S";
    case "holiday":
      return "H";
    default:
      return "";
  }
}

export function balancesRemaining(b: BalanceRow) {
  return {
    casual: Math.max(0, b.casual_allowance - b.casual_used),
    sick: Math.max(0, b.sick_allowance - b.sick_used),
    annual: Math.max(0, b.annual_allowance - b.annual_used),
  };
}
