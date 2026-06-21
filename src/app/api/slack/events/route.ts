import { NextResponse, type NextRequest } from "next/server";

import { verifySlackSignature } from "@/lib/slack/signature";
import { slackClient } from "@/lib/slack/client";
import { parseMessage, AUTO_LOG_THRESHOLD } from "@/lib/slack/parser";
import {
  resolveEmployeeBySlackId,
  notifyUnknownUser,
  dmSlackUser,
  type ResolvedEmployee,
} from "@/lib/slack/identity";
import { recordParse, upsertAttendanceLog } from "@/lib/slack/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO, toISODate } from "@/lib/date";
import { formatInstantTime, instantToLocalInput } from "@/lib/time";
import { businessDate, karachiInstant } from "@/lib/business-day";
import {
  findOpenSession,
  isStaleOpenSession,
  markSessionUnclosed,
  openSession,
  closeSession,
} from "@/lib/sessions";
import type { AttendanceType } from "@/lib/attendance";

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

/**
 * Dispatcher. Resolves the employee once, then splits the message into
 * non-empty trimmed lines and feeds each to `processLine`. Multi-line
 * messages let users do `checkin 9am\ncheckout 6pm` in one shot — each
 * line gets its own `slack_parse_log` row (synthetic ts per line so the
 * uniqueness constraint and Slack retries still behave) and the ✅
 * reaction fires once on the parent message if any line succeeded.
 *
 * Single-line messages keep their original ts and the per-line "couldn't
 * parse" DM, so existing behaviour is unchanged.
 */
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

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Fall back to single-line semantics if Slack ever hands us empty text.
  const effectiveLines = lines.length === 0 ? [rawText.trim()] : lines;
  const isMultiLine = effectiveLines.length > 1;

  let anySuccess = false;

  for (let i = 0; i < effectiveLines.length; i++) {
    const lineText = effectiveLines[i];
    const lineTs = isMultiLine ? `${messageTs}:line${i}` : messageTs;
    const ok = await processLine({
      employee,
      slackUserId,
      channelId,
      lineTs,
      lineText,
      date,
      isMultiLine,
    });
    if (ok) anySuccess = true;
  }

  if (anySuccess) await safeReact(channelId, messageTs);
}

/**
 * Process a single line of the inbound message. Returns true when the
 * line resulted in a real write (insert / checkin / checkout) — those
 * are what trigger the ✅ reaction on the parent message. Duplicate /
 * informational outcomes (already-checked-in, already-checked-out)
 * return false but still DM the user, because that signal is useful
 * even mid-multi-line.
 *
 * "Couldn't parse" and sub-threshold DMs only fire on single-line
 * messages — for multi-line the user clearly meant to log several
 * intents and we don't want to spam them about blank lines or noise.
 */
async function processLine(args: {
  employee: ResolvedEmployee;
  slackUserId: string;
  channelId: string;
  lineTs: string;
  lineText: string;
  date: string;
  isMultiLine: boolean;
}): Promise<boolean> {
  const parsed = parseMessage(args.lineText);

  if (parsed.kind === "none") {
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.lineTs,
      rawText: args.lineText,
      method: "failed",
    });
    if (alreadyProcessed) return false;
    if (!args.isMultiLine) {
      await dmSlackUser(
        args.slackUserId,
        `:thinking_face: I couldn't parse "${truncate(args.lineText, 80)}". Please use \`/attendance\` to log it.`,
      );
    }
    return false;
  }

  if (parsed.confidence < AUTO_LOG_THRESHOLD) {
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.lineTs,
      rawText: args.lineText,
      method: "regex",
      parsedType: parsed.type,
      parsedHalf: parsed.half,
      parsedDate: args.date,
      parsedReason: parsedReasonWithTime(parsed.name, parsed.time),
      confidence: parsed.confidence,
    });
    if (alreadyProcessed) return false;
    if (!args.isMultiLine) {
      await dmSlackUser(
        args.slackUserId,
        `:thinking_face: I'm not sure I read that right ("${truncate(args.lineText, 80)}"). Please use \`/attendance\` to log it precisely.`,
      );
    }
    return false;
  }

  if (parsed.intent === "checkout") {
    return await handleCheckout({
      employeeId: args.employee.id,
      slackUserId: args.slackUserId,
      lineTs: args.lineTs,
      lineText: args.lineText,
      channelId: args.channelId,
      date: args.date,
      parsedName: parsed.name,
      time: parsed.time ?? null,
    });
  }

  return await handleCheckinOrInfo({
    employeeId: args.employee.id,
    slackUserId: args.slackUserId,
    lineTs: args.lineTs,
    lineText: args.lineText,
    channelId: args.channelId,
    date: args.date,
    parsedName: parsed.name,
    intent: parsed.intent,
    type: parsed.type ?? "present",
    half: parsed.half ?? "full",
    time: parsed.time ?? null,
    confidence: parsed.confidence,
  });
}

/** "YYYY-MM-DD" + 1 day. */
function addOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

async function handleCheckout(args: {
  employeeId: string;
  slackUserId: string;
  channelId: string;
  lineTs: string;
  lineText: string;
  date: string;
  parsedName: string;
  time: string | null;
}): Promise<boolean> {
  const admin = createAdminClient();
  const open = await findOpenSession(admin, args.employeeId);

  if (!open) {
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.lineTs,
      rawText: args.lineText,
      method: "regex",
      parsedDate: args.date,
      parsedReason: parsedReasonWithTime(args.parsedName, args.time),
      confidence: 0.95,
    });
    if (alreadyProcessed) return false;
    await dmSlackUser(
      args.slackUserId,
      ":wave: I don't see any open session. Did you forget to check in?",
    );
    return false;
  }

  // Compose the checkout instant. With a parsed time, roll to the next
  // calendar day when it falls before the start's time-of-day (the normal
  // cross-midnight case). Without a time, use now.
  let endedAt: string;
  if (args.time) {
    const startLocal = instantToLocalInput(open.started_at); // YYYY-MM-DDThh:mm
    const startDate = startLocal.slice(0, 10);
    const startHHMM = startLocal.slice(11, 16);
    const endHHMM = args.time.slice(0, 5);
    const endDate = endHHMM < startHHMM ? addOneDay(startDate) : startDate;
    endedAt = karachiInstant(endDate, args.time);
  } else {
    endedAt = new Date().toISOString();
  }

  const result = await closeSession(open.id, open.started_at, endedAt);
  if (!result.ok) {
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.lineTs,
      rawText: args.lineText,
      method: "regex",
      parsedDate: open.session_date,
      parsedReason: parsedReasonWithTime(args.parsedName, args.time),
      confidence: 0.95,
      attendanceLogId: open.attendance_log_id,
    });
    if (alreadyProcessed) return false;
    if (result.reason === "too_long") {
      await dmSlackUser(
        args.slackUserId,
        ":warning: This session is over 16 hours. Please check your check-in time or contact HR.",
      );
    } else {
      await dmSlackUser(
        args.slackUserId,
        ":warning: I couldn't close that session — please check the times on the dashboard.",
      );
    }
    return false;
  }

  const { alreadyProcessed } = await recordParse({
    slackUserId: args.slackUserId,
    channelId: args.channelId,
    messageTs: args.lineTs,
    rawText: args.lineText,
    method: "regex",
    parsedDate: open.session_date,
    parsedReason: parsedReasonWithTime(args.parsedName, args.time),
    confidence: 0.95,
    attendanceLogId: open.attendance_log_id,
  });
  return !alreadyProcessed;
}

async function handleCheckinOrInfo(args: {
  employeeId: string;
  slackUserId: string;
  channelId: string;
  lineTs: string;
  lineText: string;
  date: string;
  parsedName: string;
  intent: "checkin" | "info_only";
  type: AttendanceType;
  half: import("@/lib/attendance").AttendanceHalf;
  time: string | null;
  confidence: number;
}): Promise<boolean> {
  const admin = createAdminClient();

  // ---- info_only (wfh/sick/leave/half, no session) -------------------
  if (args.intent === "info_only") {
    const attendanceLogId = await upsertAttendanceLog({
      employeeId: args.employeeId,
      date: args.date,
      type: args.type,
      half: args.half,
      reason: args.lineText,
      source: "slack",
      status: "auto_logged",
      slackMessageTs: args.lineTs,
      createdBy: args.employeeId,
    });
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.lineTs,
      rawText: args.lineText,
      method: "regex",
      parsedType: args.type,
      parsedHalf: args.half,
      parsedDate: args.date,
      parsedReason: args.parsedName,
      confidence: args.confidence,
      attendanceLogId,
    });
    return !alreadyProcessed;
  }

  // ---- checkin → open a work session --------------------------------
  // Anchor the started_at to now's Karachi wall-clock date + parsed time.
  const nowKarachiDate = toISODate(new Date());
  const startedAt = args.time
    ? karachiInstant(nowKarachiDate, args.time)
    : new Date().toISOString();
  const sessionDate = businessDate(startedAt);

  // Refuse to start a session on a leave/sick day.
  const { data: dayLog } = await admin
    .from("attendance_logs")
    .select("id, type")
    .eq("employee_id", args.employeeId)
    .eq("date", sessionDate)
    .maybeSingle<{ id: string; type: string }>();
  if (dayLog && ["full_leave", "sick", "holiday"].includes(dayLog.type)) {
    const { alreadyProcessed } = await recordParse({
      slackUserId: args.slackUserId,
      channelId: args.channelId,
      messageTs: args.lineTs,
      rawText: args.lineText,
      method: "regex",
      parsedType: args.type,
      parsedDate: sessionDate,
      parsedReason: parsedReasonWithTime(args.parsedName, args.time),
      confidence: args.confidence,
      attendanceLogId: dayLog.id,
    });
    if (alreadyProcessed) return false;
    await dmSlackUser(
      args.slackUserId,
      ":palm_tree: You're marked on leave today. Cancel the leave first if you're actually working.",
    );
    return false;
  }

  // Block a new check-in while a prior session is still open (unless it's
  // stale > 7 days — then tag it 'unclosed' for HR and proceed).
  const open = await findOpenSession(admin, args.employeeId);
  if (open) {
    if (isStaleOpenSession(open)) {
      await markSessionUnclosed(open.id);
    } else {
      const { alreadyProcessed } = await recordParse({
        slackUserId: args.slackUserId,
        channelId: args.channelId,
        messageTs: args.lineTs,
        rawText: args.lineText,
        method: "regex",
        parsedType: args.type,
        parsedDate: sessionDate,
        parsedReason: parsedReasonWithTime(args.parsedName, args.time),
        confidence: args.confidence,
        attendanceLogId: open.attendance_log_id,
      });
      if (alreadyProcessed) return false;
      await dmSlackUser(
        args.slackUserId,
        `:information_source: You have an open session from ${open.session_date} ${formatInstantTime(open.started_at)} that wasn't closed. Please add a check-out time via the dashboard before starting a new session.`,
      );
      return false;
    }
  }

  const result = await openSession({
    employeeId: args.employeeId,
    startedAt,
    type: args.type,
    half: args.half,
    source: "slack",
    createdBy: args.employeeId,
  });

  const { alreadyProcessed } = await recordParse({
    slackUserId: args.slackUserId,
    channelId: args.channelId,
    messageTs: args.lineTs,
    rawText: args.lineText,
    method: "regex",
    parsedType: args.type,
    parsedHalf: args.half,
    parsedDate: sessionDate,
    parsedReason: parsedReasonWithTime(args.parsedName, args.time),
    confidence: args.confidence,
    attendanceLogId: result?.attendanceLogId ?? null,
  });
  return !alreadyProcessed;
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
