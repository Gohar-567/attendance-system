import { NextResponse, type NextRequest } from "next/server";

import { getAppUrl } from "@/lib/env";
import { slackClient } from "@/lib/slack/client";
import { todayISO, monthLabel } from "@/lib/date";

export const runtime = "nodejs";

/**
 * 11 AM PKT (= 06:00 UTC) on the 29th of every month. Posts a single
 * reminder to #attendance (not a DM) nudging everyone to review and
 * finalize their attendance for the month before it closes.
 *
 * Cron day-of-month=29 is literal: months without a 29th (February in a
 * non-leap year) simply don't fire that month — accepted trade-off for
 * keeping this simple.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const channel = process.env.SLACK_ATTENDANCE_CHANNEL_ID;
  if (!channel) {
    return NextResponse.json(
      { ok: false, error: "SLACK_ATTENDANCE_CHANNEL_ID is not set" },
      { status: 500 },
    );
  }

  const appUrl = getAppUrl();
  const month = monthLabel(todayISO());

  try {
    await slackClient().chat.postMessage({
      channel,
      text: `Reminder: finalize your attendance for ${month} on the portal.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:spiral_calendar_pad: *${month} is wrapping up.* Take a moment to review your attendance on the portal and make sure everything's logged correctly before the month closes.`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<${appUrl}/history|Review your history> · <${appUrl}/|Open the dashboard>`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.warn("month-end-reminder post failed", err);
    return NextResponse.json({ ok: false, error: "post_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, month });
}
