/**
 * Shared input/output types for server actions.
 *
 * Files marked `"use server"` may only export async functions (Next.js
 * enforces this — non-function exports throw "A 'use server' file can
 * only export async functions" at runtime, and any imports of those
 * non-function values from client modules get proxied as opaque action
 * references, so callers that try to e.g. `.includes()` on them blow
 * up with "X.includes is not a function").
 *
 * This module is *not* `"use server"` — every type / interface that
 * needs to cross the server-action boundary lives here.
 */

import type { AttendanceHalf, EditableType } from "@/lib/attendance";
import type { LeaveType } from "@/lib/leave/types";

// ---- Shared ---------------------------------------------------------

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ---- attendance -----------------------------------------------------

export interface EditAttendanceInput {
  logId: string;
  type: EditableType;
  half: AttendanceHalf;
  reason: string | null;
  /** Phase 7C — TIMETZ "HH:MM:SS+05" or null to clear. Undefined =
   *  don't touch this column. Only applies to type ∈ Present/WFH/EWD;
   *  the SQL trigger ignores times for half/sick/leave/holiday. */
  checkinTime?: string | null;
  checkoutTime?: string | null;
}

export interface BackdatedAttendanceInput {
  date: string;
  /** Defaults to the current user. HR/admin can backfill for others. */
  employeeId?: string;
  type: EditableType;
  half: AttendanceHalf;
  reason: string | null;
  /** Phase 7C — TIMETZ strings; only sent for Present / WFH / EWD types
   *  that the form's UI exposes time pickers for. */
  checkinTime?: string | null;
  checkoutTime?: string | null;
}

// ---- leave ----------------------------------------------------------

export interface LeaveActionResult extends ActionResult {
  requestId?: string;
}

export interface SubmitLeaveActionInput {
  type: LeaveType;
  fromDate: string;
  toDate: string;
  reason: string | null;
}

export type DecideLeaveAction = "approve" | "reject";

export interface DecideLeaveActionInput {
  requestId: string;
  action: DecideLeaveAction;
  note: string | null;
}

// ---- admin: employees -----------------------------------------------

export type EmployeeRole = "employee" | "team_lead" | "hr" | "admin";

export interface CreateEmployeeInput {
  full_name: string;
  email: string;
  team_id: string | null;
  role: EmployeeRole;
  join_date: string;
  allowances?: { casual: number; sick: number; annual: number };
}

export interface UpdateEmployeeInput {
  id: string;
  full_name?: string;
  email?: string;
  team_id?: string | null;
  role?: EmployeeRole;
  join_date?: string;
  is_active?: boolean;
  allowances?: { casual: number; sick: number; annual: number };
}

// ---- admin: teams ---------------------------------------------------

export interface CreateTeamInput {
  name: string;
  lead_id: string | null;
}

// ---- settings -------------------------------------------------------

export interface UpdatePrefsInput {
  digest_enabled: boolean;
  nudge_enabled: boolean;
}
