import { NextResponse, type NextRequest } from "next/server";

import { verifySlackSignature } from "@/lib/slack/signature";
import { slackClient } from "@/lib/slack/client";
import { parseMessage, AUTO_LOG_THRESHOLD } from "@/lib/slack/parser";
import {
  resolveEmployeeBySlackId,
  notifyUnknownUser,
  dmSlackUser,
} from "@/lib/slack/identity";
import { recordParse, upsertAttendanceLog } from "@/lib/slack/log";
import { todayISO } from "@/lib/date";

export const runtime = "nodejs";

interface MessageEvent {
  type: "message";
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
}

interface SlackEnvelope {
  type: "url_verification" | "event_callback";
  challenge?: string;
  event?: MessageEvent;
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

  let envelope: SlackEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Slack URL verification handshake.
  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  if (envelope.type !== "event_callback" || !envelope.event) {
    return NextResponse.json({ ok: true });
  }

  const ev = envelope.event;
  if (ev.type !== "message") return NextResponse.json({ ok: true });

  // Ignore: bot messages, message edits/deletions, threaded replies, other channels.
  if (ev.bot_id) return NextResponse.json({ ok: true });
  if (ev.subtype) return NextResponse.json({ ok: true });
  if (ev.thread_ts && ev.thread_ts !== ev.ts) {
    return NextResponse.json({ ok: true });
  }

  const targetChannel = process.env.SLACK_ATTENDANCE_CHANNEL_ID;
  if (targetChannel && ev.channel !== targetChannel) {
    return NextResponse.json({ ok: true });
  }

  if (!ev.user || !ev.text) return NextResponse.json({ ok: true });

  // Always ack Slack first; do work inside a try so we never 500 back.
  try {
    await handleAttendanceMessage({
      slackUserId: ev.user,
      channelId: ev.channel,
      messageTs: ev.ts,
      rawText: ev.text,
    });
  } catch (err) {
    console.error("slack events handler failed", err);
  }
  return NextResponse.json({ ok: true });
}

async function handleAttendanceMessage(opts: {
  slackUserId: string;
  channelId: string;
  messageTs: string;
  rawText: string;
}) {
  const { slackUserId, channelId, messageTs, rawText } = opts;
  const date = todayISO();

  const employee = await resolveEmployeeBySlackId(slackUserId);
  if (!employee) {
    await notifyUnknownUser(slackUserId);
    await recordParse({
      slackUserId,
      channelId,
      messageTs,
      rawText,
      method: "failed",
    });
    return;
  }

  const parsed = parseMessage(rawText);

  // No regex matched at all → DM + log as failed.
  if (!parsed) {
    const { alreadyProcessed } = await recordParse({
      slackUserId,
      channelId,
      messageTs,
      rawText,
      method: "failed",
    });
    if (alreadyProcessed) return;
    await dmSlackUser(
      slackUserId,
      `:thinking_face: I couldn't parse "${truncate(rawText, 80)}". Please use \`/attendance\` to log it.`,
    );
    return;
  }

  // Regex matched but below the auto-log threshold → DM + log the attempt.
  if (parsed.confidence < AUTO_LOG_THRESHOLD) {
    const { alreadyProcessed } = await recordParse({
      slackUserId,
      channelId,
      messageTs,
      rawText,
      method: "regex",
      parsedType: parsed.type,
      parsedHalf: parsed.half,
      parsedDate: date,
      confidence: parsed.confidence,
    });
    if (alreadyProcessed) return;
    await dmSlackUser(
      slackUserId,
      `:thinking_face: I'm not sure I read that right ("${truncate(rawText, 80)}"). Please use \`/attendance\` to log it precisely.`,
    );
    return;
  }

  // High-confidence: write attendance, then react ✅.
  const attendanceLogId = await upsertAttendanceLog({
    employeeId: employee.id,
    date,
    type: parsed.type,
    half: parsed.half,
    reason: rawText,
    source: "slack",
    status: "auto_logged",
    slackMessageTs: messageTs,
    createdBy: employee.id,
  });

  const { alreadyProcessed } = await recordParse({
    slackUserId,
    channelId,
    messageTs,
    rawText,
    method: "regex",
    parsedType: parsed.type,
    parsedHalf: parsed.half,
    parsedDate: date,
    parsedReason: rawText,
    confidence: parsed.confidence,
    attendanceLogId,
  });
  if (alreadyProcessed) return;

  try {
    await slackClient().reactions.add({
      channel: channelId,
      timestamp: messageTs,
      name: "white_check_mark",
    });
  } catch (err) {
    // Reaction is non-critical; don't fail the handler if Slack rejects (e.g.,
    // already reacted, message deleted).
    console.warn("reactions.add failed", err);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
