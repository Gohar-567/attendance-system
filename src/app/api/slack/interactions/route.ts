import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifySlackSignature } from "@/lib/slack/signature";
import {
  resolveEmployeeBySlackId,
  notifyUnknownUser,
  dmSlackUser,
} from "@/lib/slack/identity";
import { recordParse, upsertAttendanceLog } from "@/lib/slack/log";
import {
  ACTION_IDS,
  ATTENDANCE_MODAL_CALLBACK,
  BLOCK_IDS,
  decodeTypeValue,
} from "@/lib/slack/modal";

export const runtime = "nodejs";

/**
 * Generic Slack interactions endpoint. Slack always sends a single form
 * field `payload` containing JSON; the JSON's `type` discriminates.
 *
 * Supported here:
 *   - view_submission (callback_id = ATTENDANCE_MODAL_CALLBACK) — write
 *     the row from the /attendance modal.
 *
 * Block-action button clicks (leave approval) land here too in Phase 4.
 */
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

  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === ATTENDANCE_MODAL_CALLBACK
  ) {
    return handleAttendanceModalSubmit(payload);
  }

  return new NextResponse("", { status: 200 });
}

interface SlackInteractionPayload {
  type: string;
  user?: { id: string };
  view?: {
    callback_id?: string;
    state?: {
      values?: Record<string, Record<string, SlackBlockValue>>;
    };
  };
}

interface SlackBlockValue {
  type: string;
  selected_option?: { value: string };
  selected_date?: string;
  value?: string;
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
    // Send the modal-error response (closes the modal cleanly) and DM in the background.
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

  // Always record the slash-command submission in slack_parse_log so the
  // admin parser-log view shows manual entries alongside auto-parsed ones.
  // Use the Slack user id and a synthetic message ts so retries don't dupe.
  const messageTs = `slash:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  if (decoded.attendanceType === "full_leave" && decoded.leaveType) {
    // Phase 3: drop a placeholder pending leave_requests row. Phase 4 wires
    // the real approval flow + Slack DM to the approver.
    const admin = createAdminClient();
    const { error } = await admin.from("leave_requests").insert({
      employee_id: employee.id,
      type: decoded.leaveType,
      from_date: date,
      to_date: date,
      reason,
      status: "pending",
    });
    if (error) {
      console.error("leave_requests insert failed", error);
      await dmSlackUser(
        slackUserId,
        `:warning: Couldn't submit your leave request: ${error.message}`,
      );
    } else {
      await dmSlackUser(
        slackUserId,
        `:hourglass: Leave request submitted for *${date}*. Approval workflow lands in the next release — for now it sits as pending.`,
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

  // Direct write to attendance_logs for wfh / ewd / sick / half_leave.
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
