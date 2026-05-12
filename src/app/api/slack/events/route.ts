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
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO } from "@/lib/date";
import {
  currentKarachiTime,
  formatTimeShort,
} from "@/lib/time";

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

  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  if (envelope.type !== "event_callback" || !envelope.event) {
    return NextResponse.json({ ok: true });
  }

  const ev = envelope.event;
  if (ev.type !== "message") return NextResponse.json({ ok: true });
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
  if (parsed.kind === "none") {
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
      parsedReason: parsedReasonWithTime(parsed.name, parsed.time),
      confidence: parsed.confidence,
    });
    if (alreadyProcessed) return;
    await dmSlackUser(
      slackUserId,
      `:thinking_face: I'm not sure I read that right ("${truncate(rawText, 80)}"). Please use \`/attendance\` to log it precisely.`,
    );
    return;
  }

  // High-confidence: branch on intent.
  if (parsed.intent === "checkout") {
    await handleCheckout({
      employeeId: employee.id,
      slackUserId,
      channelId,
      messageTs,
      rawText,
      date,
      parsedName: parsed.name,
      time: parsed.time ?? null,
    });
    return;
  }

  await handleCheckinOrInfo({
    employeeId: employee.id,
    slackUserId,
    channelId,
    messageTs,
    rawText,
    date,
    parsedName: parsed.name,
    intent: parsed.intent,
    type: parsed.type ?? "present",
    half: parsed.half ?? "full",
    time: parsed.time ?? null,
    confidence: parsed.confidence,
  });
}

async function handleCheckout(args: {
  employeeId: string;
  slackUserId: string;
  channelId: string;
  messageTs: string;
  rawText: string;
  date: string;
  parsedName: string;
  time: string | null;
}) {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("attendance_logs")
    .select("id, type, checkin_time, checkout_time")
    .eq("employee_id", args.employeeId)
    .eq("date", args.date)
    .maybeSingle<{
      id: string;
      type: string;
      checkin_time: string | null;
      checkout_time: string | null;
    }>();

  if (!existing) {
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.messageTs,
      rawText: args.rawText,
      method: "regex",
      parsedDate: args.date,
      parsedReason: parsedReasonWithTime(args.parsedName, args.time),
      confidence: 0.95,
    });
    if (alreadyProcessed) return;
    await dmSlackUser(
      args.slackUserId,
      ":wave: You haven't checked in today. Use `/attendance` to set both times.",
    );
    return;
  }

  if (existing.checkout_time) {
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.messageTs,
      rawText: args.rawText,
      method: "regex",
      parsedDate: args.date,
      parsedReason: parsedReasonWithTime(args.parsedName, args.time),
      confidence: 0.95,
      attendanceLogId: existing.id,
    });
    if (alreadyProcessed) return;
    await dmSlackUser(
      args.slackUserId,
      `:information_source: You already checked out at *${formatTimeShort(existing.checkout_time)}*. Edit the entry on the dashboard if it's wrong.`,
    );
    return;
  }

  const checkoutTime = args.time ?? currentKarachiTime();
  const { error } = await admin
    .from("attendance_logs")
    .update({ checkout_time: checkoutTime, status: "confirmed" })
    .eq("id", existing.id);
  if (error) {
    console.error("checkout update failed", error);
    return;
  }

  const { alreadyProcessed } = await recordParse({
    slackUserId: args.slackUserId,
    channelId: args.channelId,
    messageTs: args.messageTs,
    rawText: args.rawText,
    method: "regex",
    parsedDate: args.date,
    parsedReason: parsedReasonWithTime(args.parsedName, checkoutTime),
    confidence: 0.95,
    attendanceLogId: existing.id,
  });
  if (alreadyProcessed) return;

  await safeReact(args.channelId, args.messageTs);
}

async function handleCheckinOrInfo(args: {
  employeeId: string;
  slackUserId: string;
  channelId: string;
  messageTs: string;
  rawText: string;
  date: string;
  parsedName: string;
  intent: "checkin" | "info_only";
  type: import("@/lib/attendance").AttendanceType;
  half: import("@/lib/attendance").AttendanceHalf;
  time: string | null;
  confidence: number;
}) {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("attendance_logs")
    .select("id, type, checkin_time, checkout_time")
    .eq("employee_id", args.employeeId)
    .eq("date", args.date)
    .maybeSingle<{
      id: string;
      type: string;
      checkin_time: string | null;
      checkout_time: string | null;
    }>();

  // Already checked in → DM "you're already checked in" and don't overwrite.
  if (
    args.intent === "checkin" &&
    existing?.checkin_time
  ) {
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.messageTs,
      rawText: args.rawText,
      method: "regex",
      parsedType: args.type,
      parsedHalf: args.half,
      parsedDate: args.date,
      parsedReason: parsedReasonWithTime(args.parsedName, args.time),
      confidence: args.confidence,
      attendanceLogId: existing.id,
    });
    if (alreadyProcessed) return;
    await dmSlackUser(
      args.slackUserId,
      `:information_source: You're already checked in at *${formatTimeShort(existing.checkin_time)}*. Edit the entry on the dashboard if it's wrong.`,
    );
    return;
  }

  const checkinToSet =
    args.intent === "checkin" ? args.time ?? currentKarachiTime() : null;

  const attendanceLogId = await upsertAttendanceLog({
    employeeId: args.employeeId,
    date: args.date,
    type: args.type,
    half: args.half,
    reason: args.rawText,
    source: "slack",
    status: "auto_logged",
    slackMessageTs: args.messageTs,
    createdBy: args.employeeId,
    // Only send checkin_time when we're actually setting it. Sending
    // null on info_only would erase any existing checkin.
    ...(checkinToSet ? { checkinTime: checkinToSet } : {}),
  });

  const { alreadyProcessed } = await recordParse({
    slackUserId: args.slackUserId,
    channelId: args.channelId,
    messageTs: args.messageTs,
    rawText: args.rawText,
    method: "regex",
    parsedType: args.type,
    parsedHalf: args.half,
    parsedDate: args.date,
    parsedReason: parsedReasonWithTime(args.parsedName, checkinToSet),
    confidence: args.confidence,
    attendanceLogId,
  });
  if (alreadyProcessed) return;

  await safeReact(args.channelId, args.messageTs);
}

async function safeReact(channelId: string, messageTs: string) {
  try {
    await slackClient().reactions.add({
      channel: channelId,
      timestamp: messageTs,
      name: "white_check_mark",
    });
  } catch (err) {
    console.warn("reactions.add failed", err);
  }
}

/** Format we use in slack_parse_log.parsed_reason for visibility in
 *  /admin/parser-log: "<pattern_name> @ <time>" when a time was parsed. */
function parsedReasonWithTime(
  name: string,
  time: string | null | undefined,
): string {
  return time ? `${name} @ ${time.slice(0, 5)}` : name;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
