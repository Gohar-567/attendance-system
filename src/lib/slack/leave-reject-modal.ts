import type { ModalView } from "@slack/types";

export const LEAVE_REJECT_CALLBACK = "leave_reject_modal";
export const LEAVE_REJECT_BLOCK = "leave_reject_block";
export const LEAVE_REJECT_INPUT = "leave_reject_input";

/**
 * Modal opened when a Slack approver clicks "Reject". `requestId` rides
 * along in `private_metadata` so the view_submission handler can route
 * the rejection to the correct leave_requests row.
 */
export function buildLeaveRejectModal(opts: {
  requestId: string;
  requesterName: string;
}): ModalView {
  return {
    type: "modal",
    callback_id: LEAVE_REJECT_CALLBACK,
    private_metadata: opts.requestId,
    title: { type: "plain_text", text: "Reject leave" },
    submit: { type: "plain_text", text: "Reject" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Rejecting *${opts.requesterName}*'s leave request. The reason below will be sent to them.`,
        },
      },
      {
        type: "input",
        block_id: LEAVE_REJECT_BLOCK,
        label: { type: "plain_text", text: "Reason" },
        element: {
          type: "plain_text_input",
          action_id: LEAVE_REJECT_INPUT,
          multiline: true,
          max_length: 500,
        },
      },
    ],
  };
}
