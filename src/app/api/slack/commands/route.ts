import { NextResponse, type NextRequest } from "next/server";

import { verifySlackSignature } from "@/lib/slack/signature";
import { slackClient } from "@/lib/slack/client";
import { buildAttendanceModal } from "@/lib/slack/modal";

export const runtime = "nodejs";

/**
 * Slash command handler for `/attendance`. Slack sends form-encoded
 * payload; we open a modal via views.open and ack with 200.
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
  const command = params.get("command");
  const triggerId = params.get("trigger_id");

  if (command !== "/attendance" || !triggerId) {
    return new NextResponse("", { status: 200 });
  }

  try {
    await slackClient().views.open({
      trigger_id: triggerId,
      view: buildAttendanceModal(),
    });
  } catch (err) {
    console.error("views.open failed", err);
    return NextResponse.json(
      {
        response_type: "ephemeral",
        text: ":warning: Couldn't open the attendance form. Try again in a moment.",
      },
      { status: 200 },
    );
  }

  return new NextResponse("", { status: 200 });
}
