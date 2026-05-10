import { slackClient } from "./client";
import { LEAVE_TYPE_LABEL, type LeaveRequest } from "@/lib/leave/types";
import { longDate } from "@/lib/date";
import type { TeamConflict } from "@/lib/leave/conflicts";

interface DmContext {
  request: LeaveRequest;
  requesterName: string;
  requesterTeam: string | null;
  workingDays: number;
  balanceAfter: number | null;
  conflicts: TeamConflict[];
  approverSlackId: string;
  webUrl: string;
}

/**
 * Build the Block Kit payload for the approval DM. Action ids encode the
 * leave_requests.id so /api/slack/interactions can route the click.
 */
function buildBlocks(ctx: DmContext) {
  const { request, requesterName, requesterTeam, workingDays, balanceAfter, conflicts, webUrl } = ctx;

  const headerLines = [
    `*${requesterName}* — ${requesterTeam ?? "no team"}`,
    `${LEAVE_TYPE_LABEL[request.type]} leave • ${longDate(request.from_date)} → ${longDate(request.to_date)}`,
    `${workingDays} working day${workingDays === 1 ? "" : "s"}` +
      (balanceAfter != null ? ` • Balance after: *${balanceAfter}*` : ""),
  ];

  const conflictLine =
    conflicts.length === 0
      ? ":white_check_mark: No team conflicts."
      : `:warning: Also off: ${conflicts
          .map((c) => `*${c.full_name}*`)
          .join(", ")}`;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:wave: New leave request:\n${headerLines.join("\n")}`,
      },
    },
    request.reason
      ? {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `>${request.reason.replace(/\n/g, "\n>")}`,
          },
        }
      : null,
    { type: "context", elements: [{ type: "mrkdwn", text: conflictLine }] },
    {
      type: "actions",
      block_id: `leave_actions:${request.id}`,
      elements: [
        {
          type: "button",
          action_id: `leave_approve:${request.id}`,
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          value: request.id,
        },
        {
          type: "button",
          action_id: `leave_reject:${request.id}`,
          style: "danger",
          text: { type: "plain_text", text: "Reject" },
          value: request.id,
        },
        {
          type: "button",
          action_id: `leave_view:${request.id}`,
          text: { type: "plain_text", text: "View on web" },
          url: webUrl,
        },
      ],
    },
  ].filter(Boolean);
}

/**
 * Post the approval DM and return Slack's channel + ts so the caller can
 * record them on the leave_requests row (we'll need them to edit the DM
 * after the decision lands).
 */
export async function sendLeaveApprovalDM(
  ctx: DmContext,
): Promise<{ channel: string | null; ts: string | null }> {
  if (!ctx.approverSlackId) return { channel: null, ts: null };

  const text = `New leave request from ${ctx.requesterName}: ${LEAVE_TYPE_LABEL[ctx.request.type]} ${ctx.request.from_date} → ${ctx.request.to_date}`;
  try {
    const res = await slackClient().chat.postMessage({
      channel: ctx.approverSlackId,
      text,
      blocks: buildBlocks(ctx) as never,
    });
    return { channel: res.channel ?? null, ts: res.ts ?? null };
  } catch (err) {
    console.warn("sendLeaveApprovalDM failed", err);
    return { channel: null, ts: null };
  }
}

/**
 * Replace the original DM's body so it no longer shows actionable buttons.
 * Called after approve / reject from web or Slack.
 */
export async function editDmAfterDecision(opts: {
  channel: string;
  ts: string;
  requesterName: string;
  request: LeaveRequest;
  decision: "approved" | "rejected";
  deciderName: string;
  decisionNote: string | null;
}) {
  const { channel, ts, requesterName, request, decision, deciderName, decisionNote } = opts;
  const headline =
    decision === "approved"
      ? `:white_check_mark: *Approved by ${deciderName}*`
      : `:x: *Rejected by ${deciderName}*${decisionNote ? ` — ${decisionNote}` : ""}`;

  const text = `${requesterName}'s ${LEAVE_TYPE_LABEL[request.type]} leave (${request.from_date} → ${request.to_date}) — ${decision}`;
  try {
    await slackClient().chat.update({
      channel,
      ts,
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${headline}\n*${requesterName}* — ${LEAVE_TYPE_LABEL[request.type]} leave\n${longDate(request.from_date)} → ${longDate(request.to_date)}`,
          },
        },
      ],
    });
  } catch (err) {
    console.warn("editDmAfterDecision failed", err);
  }
}
