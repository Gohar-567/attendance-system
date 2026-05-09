import { todayISO } from "@/lib/date";
import type { ModalView } from "@slack/types";

export const ATTENDANCE_MODAL_CALLBACK = "attendance_modal_submit";

/**
 * Stable option values used in both the modal payload and the
 * view_submission handler. Format: `{type}` or `{type}:{variant}`.
 */
export const TYPE_OPTIONS = [
  { value: "full_leave:casual", text: "Full leave — Casual" },
  { value: "full_leave:sick", text: "Full leave — Sick" },
  { value: "full_leave:annual", text: "Full leave — Annual" },
  { value: "half_leave:first_half", text: "Half day — First half" },
  { value: "half_leave:second_half", text: "Half day — Second half" },
  { value: "wfh", text: "Working from home" },
  { value: "ewd", text: "External work day" },
  { value: "sick", text: "Sick (full day)" },
] as const;

export const BLOCK_IDS = {
  type: "type_block",
  date: "date_block",
  reason: "reason_block",
} as const;

export const ACTION_IDS = {
  type: "type_select",
  date: "date_picker",
  reason: "reason_input",
} as const;

/**
 * Earliest allowed date for the modal's date picker (today minus 30 days).
 */
function thirtyDaysAgoISO(): string {
  const today = new Date(`${todayISO()}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - 30);
  return today.toISOString().slice(0, 10);
}

export function buildAttendanceModal(): ModalView {
  const today = todayISO();
  return {
    type: "modal",
    callback_id: ATTENDANCE_MODAL_CALLBACK,
    title: { type: "plain_text", text: "Log attendance" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: BLOCK_IDS.type,
        label: { type: "plain_text", text: "Type" },
        element: {
          type: "static_select",
          action_id: ACTION_IDS.type,
          placeholder: { type: "plain_text", text: "Pick one" },
          options: TYPE_OPTIONS.map((o) => ({
            text: { type: "plain_text", text: o.text },
            value: o.value,
          })),
        },
      },
      {
        type: "input",
        block_id: BLOCK_IDS.date,
        label: { type: "plain_text", text: "Date" },
        element: {
          type: "datepicker",
          action_id: ACTION_IDS.date,
          initial_date: today,
        },
        hint: {
          type: "plain_text",
          text: `Pick any date from ${thirtyDaysAgoISO()} to ${today}.`,
        },
      },
      {
        type: "input",
        block_id: BLOCK_IDS.reason,
        optional: true,
        label: { type: "plain_text", text: "Reason (optional)" },
        element: {
          type: "plain_text_input",
          action_id: ACTION_IDS.reason,
          multiline: true,
          max_length: 500,
        },
      },
    ],
  };
}

/**
 * Map a TYPE_OPTIONS value back to the rich type+half+leave_type triple.
 */
export function decodeTypeValue(value: string): {
  attendanceType: "wfh" | "ewd" | "sick" | "half_leave" | "full_leave";
  half: "full" | "first_half" | "second_half";
  leaveType: "casual" | "sick" | "annual" | null;
} {
  const [head, variant] = value.split(":");
  switch (head) {
    case "wfh":
      return { attendanceType: "wfh", half: "full", leaveType: null };
    case "ewd":
      return { attendanceType: "ewd", half: "full", leaveType: null };
    case "sick":
      return { attendanceType: "sick", half: "full", leaveType: null };
    case "half_leave":
      return {
        attendanceType: "half_leave",
        half: (variant as "first_half" | "second_half") ?? "full",
        leaveType: null,
      };
    case "full_leave":
      return {
        attendanceType: "full_leave",
        half: "full",
        leaveType: (variant as "casual" | "sick" | "annual") ?? "casual",
      };
    default:
      throw new Error(`Unknown modal type value: ${value}`);
  }
}
