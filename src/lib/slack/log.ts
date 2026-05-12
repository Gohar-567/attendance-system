import { createAdminClient } from "@/lib/supabase/admin";
import type { AttendanceHalf, AttendanceType } from "@/lib/attendance";
import { todayISO } from "@/lib/date";

type ParseMethod = "regex" | "claude_api" | "slash_command" | "failed";

export interface ParseLogInput {
  slackUserId: string;
  channelId: string;
  messageTs: string;
  rawText: string;
  method: ParseMethod;
  parsedType?: AttendanceType | null;
  parsedHalf?: AttendanceHalf | null;
  parsedDate?: string | null;
  parsedReason?: string | null;
  confidence?: number | null;
  attendanceLogId?: string | null;
}

/**
 * Idempotently insert into slack_parse_log.
 *
 * Slack retries failed deliveries; the (slack_message_ts, slack_channel_id)
 * unique constraint plus ON CONFLICT keeps us at exactly one row per
 * inbound message. Returns true if the row already existed (caller can
 * skip downstream processing).
 */
export async function recordParse(input: ParseLogInput): Promise<{
  alreadyProcessed: boolean;
}> {
  const admin = createAdminClient();

  const existing = await admin
    .from("slack_parse_log")
    .select("id")
    .eq("slack_channel_id", input.channelId)
    .eq("slack_message_ts", input.messageTs)
    .maybeSingle();

  if (existing.data) return { alreadyProcessed: true };

  await admin.from("slack_parse_log").insert({
    slack_user_id: input.slackUserId,
    slack_channel_id: input.channelId,
    slack_message_ts: input.messageTs,
    raw_text: input.rawText,
    method: input.method,
    parsed_type: input.parsedType ?? null,
    parsed_half: input.parsedHalf ?? null,
    parsed_date: input.parsedDate ?? null,
    parsed_reason: input.parsedReason ?? null,
    confidence: input.confidence ?? null,
    attendance_log_id: input.attendanceLogId ?? null,
    awaiting_confirm: false,
  });

  return { alreadyProcessed: false };
}

/**
 * Upsert an attendance_logs row for (employee_id, date) and return the row id.
 * Source defaults to 'slack' for events; pass 'slash_command' for the modal flow.
 * Hours columns (checkin_time, checkout_time) are optional and only sent when
 * the caller wants to set them — the SQL trigger recomputes total_hours.
 */
export async function upsertAttendanceLog(opts: {
  employeeId: string;
  date?: string;
  type: AttendanceType;
  half?: AttendanceHalf;
  reason?: string | null;
  source?: "slack" | "slash_command" | "web";
  status?: "auto_logged" | "confirmed" | "approved";
  slackMessageTs?: string | null;
  createdBy?: string | null;
  checkinTime?: string | null;
  checkoutTime?: string | null;
}): Promise<string | null> {
  const admin = createAdminClient();
  const date = opts.date ?? todayISO();

  const row: Record<string, unknown> = {
    employee_id: opts.employeeId,
    date,
    type: opts.type,
    half: opts.half ?? "full",
    reason: opts.reason ?? null,
    status: opts.status ?? "auto_logged",
    source: opts.source ?? "slack",
    slack_message_ts: opts.slackMessageTs ?? null,
    created_by: opts.createdBy ?? opts.employeeId,
  };
  if (opts.checkinTime !== undefined) row.checkin_time = opts.checkinTime;
  if (opts.checkoutTime !== undefined) row.checkout_time = opts.checkoutTime;

  const { data, error } = await admin
    .from("attendance_logs")
    .upsert(row, { onConflict: "employee_id,date" })
    .select("id")
    .single();

  if (error) {
    console.error("upsertAttendanceLog failed", error);
    return null;
  }
  return data.id as string;
}
