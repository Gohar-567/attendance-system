import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifySlackSignature } from "@/lib/slack/signature";
import { slackClient } from "@/lib/slack/client";
import {
  resolveEmployeeBySlackId,
  notifyUnknownUser,
  dmSlackUser,
} from "@/lib/slack/identity";
import { recordParse, upsertAttendanceLog } from "@/lib/slack/log";
import { openSession } from "@/lib/sessions";
import {
  ACTION_IDS,
  ATTENDANCE_MODAL_CALLBACK,
  BLOCK_IDS,
  decodeTypeValue,
} from "@/lib/slack/modal";
import {
  LEAVE_REJECT_BLOCK,
  LEAVE_REJECT_CALLBACK,
  LEAVE_REJECT_INPUT,
  buildLeaveRejectModal,
} from "@/lib/slack/leave-reject-modal";
import { decideLeaveRequest } from "@/lib/leave/decide";
import { canActOn, getApproversFor } from "@/lib/leave/routing";
import { submitLeaveRequest } from "@/lib/leave/submit";
import type { ApproverEmployee, LeaveRequest } from "@/lib/leave/types";
import { buildNudgeAcknowledgedBlocks } from "@/lib/cron/nudge";

export const runtime = "nodejs";

interface SlackBlockValue {
  type: string;
  selected_option?: { value: string };
  selected_date?: string;
  value?: string;
}

interface SlackBlockAction {
  action_id: string;
  block_id: string;
  value?: string;
}

interface SlackInteractionPayload {
  type: string;
  trigger_id?: string;
  user?: { id: string; name?: string };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, SlackBlockValue>>;
    };
  };
  actions?: SlackBlockAction[];
  message?: { ts?: string };
  channel?: { id?: string };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json(
      { error: "SLACK_SIGNING_SECRET not configured" },
      { status: 500 },
    );
  }

  const valid = verifySlackSignature({
    signingSecret,
    signature: req.headers.get("x-slack-signature"),
    timestamp: req.headers.get("x-slack-request-timestamp"),
    rawBody,
  });
  if (!valid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) return new NextResponse("", { status: 200 });

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  // Slash-command modal submission (Phase 3).
  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === ATTENDANCE_MODAL_CALLBACK
  ) {
    return handleAttendanceModalSubmit(payload);
  }

  // Leave reject modal submission.
  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === LEAVE_REJECT_CALLBACK
  ) {
    return handleLeaveRejectModalSubmit(payload);
  }

  // Approve / Reject button clicks on the approval DM.
  if (payload.type === "block_actions" && payload.actions?.length) {
    const action = payload.actions[0];
    if (action.action_id.startsWith("leave_approve:")) {
      // Ack immediately; do work after.
      handleLeaveApproveClick(payload).catch((e) =>
        console.error("leave_approve handler failed", e),
      );
      return new NextResponse("", { status: 200 });
    }
    if (action.action_id.startsWith("leave_reject:")) {
      handleLeaveRejectClick(payload).catch((e) =>
        console.error("leave_reject handler failed", e),
      );
      return new NextResponse("", { status: 200 });
    }
    if (action.action_id.startsWith("nudge:")) {
      handleNudgeClick(payload).catch((e) =>
        console.error("nudge handler failed", e),
      );
      return new NextResponse("", { status: 200 });
    }
  }

  return new NextResponse("", { status: 200 });
}

async function handleAttendanceModalSubmit(payload: SlackInteractionPayload) {
  const slackUserId = payload.user?.id;
  if (!slackUserId) return new NextResponse("", { status: 200 });

  const values = payload.view?.state?.values ?? {};
  const typeValue =
    values[BLOCK_IDS.type]?.[ACTION_IDS.type]?.selected_option?.value;
  const date =
    values[BLOCK_IDS.date]?.[ACTION_IDS.date]?.selected_date ?? null;
  const reason =
    values[BLOCK_IDS.reason]?.[ACTION_IDS.reason]?.value?.trim() || null;

  if (!typeValue || !date) {
    return NextResponse.json({
      response_action: "errors",
      errors: {
        [BLOCK_IDS.type]: typeValue ? "" : "Pick a type",
        [BLOCK_IDS.date]: date ? "" : "Pick a date",
      },
    });
  }

  const employee = await resolveEmployeeBySlackId(slackUserId);
  if (!employee) {
    notifyUnknownUser(slackUserId).catch((e) =>
      console.warn("notifyUnknownUser failed", e),
    );
    return NextResponse.json({
      response_action: "errors",
      errors: {
        [BLOCK_IDS.type]:
          "You're not in the system yet. I sent you a DM with details.",
      },
    });
  }

  const decoded = decodeTypeValue(typeValue);
  const messageTs = `slash:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  // Full leave routes through the proper submit pipeline (DM the approver).
  if (decoded.attendanceType === "full_leave" && decoded.leaveType) {
    const result = await submitLeaveRequest({
      employeeId: employee.id,
      type: decoded.leaveType,
      fromDate: date,
      toDate: date,
      reason,
    });

    if (!result.ok) {
      await dmSlackUser(
        slackUserId,
        `:warning: Couldn't submit your leave request: ${result.error}`,
      );
    } else {
      await dmSlackUser(
        slackUserId,
        `:hourglass: Leave request submitted for *${date}*. ${result.routedTo === "team_lead" ? "Your team lead has been notified." : "HR has been notified."}`,
      );
    }

    await recordParse({
      slackUserId,
      channelId: "slash_command",
      messageTs,
      rawText: `/attendance ${typeValue} ${date}${reason ? ` — ${reason}` : ""}`,
      method: "slash_command",
      parsedType: "full_leave",
      parsedHalf: "full",
      parsedDate: date,
      parsedReason: reason,
      confidence: 1.0,
    });
    return new NextResponse("", { status: 200 });
  }

  // wfh / ewd / sick / half_leave: direct attendance write.
  const attendanceLogId = await upsertAttendanceLog({
    employeeId: employee.id,
    date,
    type: decoded.attendanceType,
    half: decoded.half,
    reason,
    source: "slash_command",
    status: "confirmed",
    createdBy: employee.id,
  });

  await recordParse({
    slackUserId,
    channelId: "slash_command",
    messageTs,
    rawText: `/attendance ${typeValue} ${date}${reason ? ` — ${reason}` : ""}`,
    method: "slash_command",
    parsedType: decoded.attendanceType,
    parsedHalf: decoded.half,
    parsedDate: date,
    parsedReason: reason,
    confidence: 1.0,
    attendanceLogId,
  });

  await dmSlackUser(
    slackUserId,
    `:white_check_mark: Logged *${typeValue.replace(":", " — ")}* for *${date}*.`,
  );

  return new NextResponse("", { status: 200 });
}

async function handleLeaveApproveClick(payload: SlackInteractionPayload) {
  const slackUserId = payload.user?.id;
  const action = payload.actions?.[0];
  if (!slackUserId || !action) return;
  const requestId = action.action_id.split(":")[1];

  const actor = await resolveEmployeeBySlackId(slackUserId);
  if (!actor) {
    await notifyUnknownUser(slackUserId);
    return;
  }

  // Authorization gate: ensure this Slack user can act on this request now.
  const admin = createAdminClient();
  const { data: req } = await admin
    .from("leave_requests")
    .select("id, employee_id, created_at, status")
    .eq("id", requestId)
    .maybeSingle<Pick<LeaveRequest, "id" | "employee_id" | "created_at" | "status">>();
  if (!req) return;
  const routing = await getApproversFor(admin, req);
  if (!canActOn(actor as ApproverEmployee, req, routing)) {
    await dmSlackUser(
      slackUserId,
      `:no_entry_sign: You're no longer authorized to act on that request — it may have escalated to HR.`,
    );
    return;
  }

  await decideLeaveRequest({
    requestId,
    decider: actor as ApproverEmployee,
    action: "approve",
    note: null,
  });
}

async function handleLeaveRejectClick(payload: SlackInteractionPayload) {
  const action = payload.actions?.[0];
  const triggerId = payload.trigger_id;
  const slackUserId = payload.user?.id;
  if (!action || !triggerId || !slackUserId) return;
  const requestId = action.action_id.split(":")[1];

  // Look up requester name to show in the modal.
  const admin = createAdminClient();
  const { data: req } = await admin
    .from("leave_requests")
    .select("id, employee_id")
    .eq("id", requestId)
    .maybeSingle<Pick<LeaveRequest, "id" | "employee_id">>();
  let requesterName = "the requester";
  if (req) {
    const { data: emp } = await admin
      .from("employees")
      .select("full_name")
      .eq("id", req.employee_id)
      .maybeSingle();
    if (emp?.full_name) requesterName = emp.full_name;
  }

  try {
    await slackClient().views.open({
      trigger_id: triggerId,
      view: buildLeaveRejectModal({ requestId, requesterName }),
    });
  } catch (err) {
    console.warn("views.open (reject modal) failed", err);
  }
}

async function handleLeaveRejectModalSubmit(payload: SlackInteractionPayload) {
  const slackUserId = payload.user?.id;
  const requestId = payload.view?.private_metadata;
  if (!slackUserId || !requestId) return new NextResponse("", { status: 200 });

  const note =
    payload.view?.state?.values?.[LEAVE_REJECT_BLOCK]?.[LEAVE_REJECT_INPUT]
      ?.value?.trim() || null;
  if (!note) {
    return NextResponse.json({
      response_action: "errors",
      errors: { [LEAVE_REJECT_BLOCK]: "Give a brief reason" },
    });
  }

  const actor = await resolveEmployeeBySlackId(slackUserId);
  if (!actor) {
    return NextResponse.json({
      response_action: "errors",
      errors: { [LEAVE_REJECT_BLOCK]: "You're not in the system yet" },
    });
  }

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("leave_requests")
    .select("id, employee_id, created_at, status")
    .eq("id", requestId)
    .maybeSingle<Pick<LeaveRequest, "id" | "employee_id" | "created_at" | "status">>();
  if (!req) {
    return NextResponse.json({
      response_action: "errors",
      errors: { [LEAVE_REJECT_BLOCK]: "Request not found" },
    });
  }
  const routing = await getApproversFor(admin, req);
  if (!canActOn(actor as ApproverEmployee, req, routing)) {
    return NextResponse.json({
      response_action: "errors",
      errors: { [LEAVE_REJECT_BLOCK]: "Not authorized" },
    });
  }

  // Run the decision after we ack the modal so Slack closes it cleanly.
  decideLeaveRequest({
    requestId,
    decider: actor as ApproverEmployee,
    action: "reject",
    note,
  }).catch((e) => console.error("reject decide failed", e));

  return new NextResponse("", { status: 200 });
}


async function handleNudgeClick(payload: SlackInteractionPayload) {
  const slackUserId = payload.user?.id;
  const action = payload.actions?.[0];
  const channelId = payload.channel?.id;
  const messageTs = payload.message?.ts;
  if (!slackUserId || !action) return;

  // action_id format: nudge:<type>:<date>
  const parts = action.action_id.split(":");
  const type = parts[1] as "present" | "wfh" | "half_leave" | "sick";
  const date = parts[2];
  if (!type || !date) return;

  const employee = await resolveEmployeeBySlackId(slackUserId);
  if (!employee) {
    await notifyUnknownUser(slackUserId);
    return;
  }

  const admin = createAdminClient();

  // "At office" / "WFH" → create the day's row AND open a work session
  // (this was the Faizan bug: previously only a confirmation, no session).
  // "Half day" / "Sick" → set the type only, no session.
  if (type === "present" || type === "wfh") {
    const result = await openSession({
      employeeId: employee.id,
      startedAt: new Date().toISOString(),
      type,
      source: "nudge_button",
      createdBy: employee.id,
    });
    await admin.from("audit_log").insert({
      actor_id: employee.id,
      action: "nudge_button_logged",
      target_type: "work_session",
      target_id: result?.sessionId ?? null,
      details: { type, date, via: "nudge_button" },
    });
  } else {
    const attendanceLogId = await upsertAttendanceLog({
      employeeId: employee.id,
      date,
      type,
      half: type === "half_leave" ? "first_half" : "full",
      source: "slack",
      status: "confirmed",
      createdBy: employee.id,
    });
    await admin.from("audit_log").insert({
      actor_id: employee.id,
      action: "nudge_button_logged",
      target_type: "attendance_log",
      target_id: attendanceLogId,
      details: { type, date, via: "nudge_button" },
    });
  }

  // Edit the original DM so the buttons disappear and the choice is shown.
  if (channelId && messageTs) {
    try {
      await slackClient().chat.update({
        channel: channelId,
        ts: messageTs,
        text: `Logged ${type} for ${date}`,
        blocks: buildNudgeAcknowledgedBlocks({
          fullName: employee.full_name,
          date,
          type,
        }) as never,
      });
    } catch (err) {
      console.warn("nudge chat.update failed", err);
    }
  }
}
