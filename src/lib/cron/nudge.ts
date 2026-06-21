/**
 * Block Kit payload for the morning nudge DM. Buttons fire through
 * /api/slack/interactions with action_ids:
 *   nudge:present:<date>   nudge:wfh:<date>
 *   nudge:half_leave:<date> nudge:sick:<date>
 */
export function buildNudgeBlocks(opts: {
  fullName: string;
  date: string;
  appUrl: string;
}) {
  const { fullName, date, appUrl } = opts;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:sun_with_face: Morning *${fullName}* — haven't seen you in #attendance yet today. Quick log?`,
      },
    },
    {
      type: "actions",
      block_id: `nudge_actions:${date}`,
      elements: [
        {
          type: "button",
          action_id: `nudge:present:${date}`,
          style: "primary",
          text: { type: "plain_text", text: "At office" },
          value: "present",
        },
        {
          type: "button",
          action_id: `nudge:wfh:${date}`,
          text: { type: "plain_text", text: "WFH" },
          value: "wfh",
        },
        {
          type: "button",
          action_id: `nudge:half_leave:${date}`,
          text: { type: "plain_text", text: "Half day" },
          value: "half_leave",
        },
        {
          type: "button",
          action_id: `nudge:sick:${date}`,
          text: { type: "plain_text", text: "Sick" },
          value: "sick",
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Need to backdate or pick something else? <${appUrl}/|Open the dashboard> · <${appUrl}/settings|Mute these>`,
        },
      ],
    },
  ];
}

/** Static body shown after a nudge button is clicked. */
export function buildNudgeAcknowledgedBlocks(opts: {
  fullName: string;
  date: string;
  type: string;
}) {
  // "At office" / "WFH" open a live work session — remind them to check out.
  const opensSession = opts.type === "present" || opts.type === "wfh";
  const tail = opensSession
    ? ` You're checked in — reply \`checkout\` or post in #attendance when you finish.`
    : "";
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: Logged for *${opts.fullName}* on *${opts.date}*: *${opts.type.replace("_", " ")}*.${tail}`,
      },
    },
  ];
}
