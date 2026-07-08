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
  await admin
    .from("leave_requests")
    .delete()
    .eq("employee_id", employeeId)
    .eq("source", "attendance")
    .eq("from_date", date)
    .eq("to_date", date);
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

  await admin.from("leave_requests").insert({
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
}
