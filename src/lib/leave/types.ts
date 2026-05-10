export type LeaveType = "casual" | "sick" | "annual";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  employee_id: string;
  type: LeaveType;
  from_date: string;
  to_date: string;
  reason: string | null;
  status: LeaveStatus;
  approver_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface ApproverEmployee {
  id: string;
  full_name: string;
  email: string;
  role: "employee" | "team_lead" | "hr" | "admin";
  slack_user_id: string | null;
  team_id: string | null;
}

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  casual: "Casual",
  sick: "Sick",
  annual: "Annual",
};

/** Hours after which a pending request escalates to HR. */
export const ESCALATION_HOURS = 48;
