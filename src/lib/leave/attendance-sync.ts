import type { SupabaseClient } from "@supabase/supabase-js";

import type { EditableType } from "@/lib/attendance";
import type { LeaveType } from "./types";

/**
 * The bridge that keeps leave_requests as the single source of truth for
 * balances even when a leave-consuming day is logged through the Add-entry
 * modal (which only writes attendance_logs).
 *
 * Only two of the modal's types consume a leave balance:
 *   - Sick       → a full Sick day
 *   - Half leave → half a Casual day (the org has no "half" balance)
 * Present / WFH / EWD consume nothing → no leave_request.
 *
 * Over-consumption is intentionally allowed (not blocked): matching the
 * existing apply→approve flow, which never rejects a request for exceeding
 * the allowance. The balance card shows `used / allowance` (e.g. 9/8) so an
 * overrun is visible, and "remaining" is floored at 0 in the UI.
 */
export function leaveShapeForAttendance(
  type: EditableType,
): { leaveType: LeaveType; days: number } | null {
  switch (type) {
    case "sick":
      return { leaveType: "sick", days: 1 };
    case "half_leave":
      return { leaveType: "casual", days: 0.5 };
    default:
      return null;
  }
}

/**
 * Remove any attendance-sourced leave_request for one employee+day. Used
 * before re-syncing (so repeated saves / type changes never double-count)
 * and when an attendance row is deleted. Attendance-sourced rows are always
 * single-day (from_date = to_date = the day).
 */
export async function clearAttendanceLeaveForDay(
  admin: SupabaseClient,
  employeeId: string,
  date: string,
): Promise<void> {
  const { error } = await admin
    .from("leave_requests")
    .delete()
    .eq("employee_id", employeeId)
    .eq("source", "attendance")
    .eq("from_date", date)
    .eq("to_date", date);
  // The Supabase client returns errors rather than throwing; surface them
  // so callers can decide whether to degrade gracefully.
  if (error) throw new Error(`clearAttendanceLeaveForDay: ${error.message}`);
}

/**
 * Reconcile the attendance-sourced leave_request for one day to match the
 * day's attendance type. Idempotent: clears the prior synced row, then
 * writes a fresh approved leave_request when the type consumes a balance.
 *
 * Runs on the service-role admin client (RLS bypassed), matching the rest
 * of the attendance write path.
 */
export async function syncAttendanceLeaveForDay(
  admin: SupabaseClient,
  opts: {
    employeeId: string;
    date: string;
    type: EditableType;
    reason: string | null;
    /** The signed-in user performing the save — recorded as approver. */
    actorId: string;
  },
): Promise<void> {
  await clearAttendanceLeaveForDay(admin, opts.employeeId, opts.date);

  const shape = leaveShapeForAttendance(opts.type);
  if (!shape) return;

  const { error } = await admin.from("leave_requests").insert({
    employee_id: opts.employeeId,
    type: shape.leaveType,
    from_date: opts.date,
    to_date: opts.date,
    days: shape.days,
    reason: opts.reason,
    status: "approved",
    approver_id: opts.actorId,
    decided_at: new Date().toISOString(),
    source: "attendance",
  });
  if (error) throw new Error(`syncAttendanceLeaveForDay: ${error.message}`);
}
