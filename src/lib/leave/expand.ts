import type { SupabaseClient } from "@supabase/supabase-js";

import type { AttendanceType } from "@/lib/attendance";
import type { LeaveRequest, LeaveType } from "./types";
import { fetchHolidaySet } from "./holidays";
import { iterateWorkingDays } from "./working-days";

/** Map a leave_type to the attendance_type and reason prefix for the
 *  expanded attendance_logs rows. */
function attendanceShape(type: LeaveType): {
  attendanceType: AttendanceType;
  reasonPrefix: string;
} {
  switch (type) {
    case "casual":
      return { attendanceType: "full_leave", reasonPrefix: "Casual leave" };
    case "annual":
      return { attendanceType: "full_leave", reasonPrefix: "Annual leave" };
    case "sick":
      return { attendanceType: "sick", reasonPrefix: "Sick leave" };
  }
}

/**
 * Expand an approved leave_requests row into one attendance_logs row per
 * working day in [from_date, to_date]. Weekends + holidays are skipped.
 *
 * Uses upsert on (employee_id, date) so if the user previously logged WFH
 * for one of those days, the leave-approved row replaces it.
 *
 * Runs with the service-role admin client so RLS doesn't trip the writes
 * even when the actor is the team lead, not the requester.
 */
export async function expandLeaveToAttendance(
  admin: SupabaseClient,
  request: LeaveRequest,
  approverId: string,
): Promise<{ daysWritten: number }> {
  const holidays = await fetchHolidaySet(
    admin,
    request.from_date,
    request.to_date,
  );

  const { attendanceType, reasonPrefix } = attendanceShape(request.type);
  const baseReason = request.reason
    ? `${reasonPrefix} — ${request.reason}`
    : reasonPrefix;

  const rows = [];
  for (const date of iterateWorkingDays(
    request.from_date,
    request.to_date,
    holidays,
  )) {
    rows.push({
      employee_id: request.employee_id,
      date,
      type: attendanceType,
      half: "full" as const,
      reason: baseReason,
      status: "approved" as const,
      source: "leave_request",
      created_by: approverId,
    });
  }

  if (rows.length === 0) return { daysWritten: 0 };

  const { error } = await admin
    .from("attendance_logs")
    .upsert(rows, { onConflict: "employee_id,date" });

  if (error) {
    console.error("expandLeaveToAttendance upsert failed", error);
    return { daysWritten: 0 };
  }
  return { daysWritten: rows.length };
}
