import { dowOf, longDate } from "@/lib/date";

/**
 * Find the most recently completed Sunday on or before todayISO. The cron
 * runs Sunday 7 PM PKT, so on the day-of this returns today; if hit
 * manually mid-week it returns the previous Sunday.
 */
export function lastSundayISO(todayISO: string): string {
  const [y, m, d] = todayISO.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0 = Sun
  date.setUTCDate(date.getUTCDate() - dow);
  return date.toISOString().slice(0, 10);
}

/** Mon..Sun ISO date strings ending on `sundayISO`. */
export function weekDays(sundayISO: string): string[] {
  const [y, m, d] = sundayISO.split("-").map(Number);
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const t = new Date(Date.UTC(y, m - 1, d - i));
    days.push(t.toISOString().slice(0, 10));
  }
  return days;
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Map an attendance log + context into a single emoji square.
 *  🟩 present, 🟦 wfh/ewd, 🟧 half, 🟥 leave/sick,
 *  ⬜ off (weekend, holiday, no log), ⬛ before join_date
 */
export function dayGlyph(opts: {
  iso: string;
  joinDateISO: string;
  log?: { type: string } | null;
  isHoliday: boolean;
}): string {
  if (opts.iso < opts.joinDateISO) return "⬛";
  if (opts.log) {
    switch (opts.log.type) {
      case "present":
        return "🟩";
      case "wfh":
      case "ewd":
        return "🟦";
      case "half_leave":
        return "🟧";
      case "full_leave":
      case "sick":
        return "🟥";
      case "holiday":
        return "⬜";
      default:
        return "⬜";
    }
  }
  if (opts.isHoliday) return "⬜";
  const dow = dowOf(opts.iso);
  if (dow === 0 || dow === 6) return "⬜";
  return "⬜";
}

export interface DigestData {
  fullName: string;
  weekStartISO: string;
  weekEndISO: string;
  joinDateISO: string;
  /** 7 emoji squares Mon..Sun */
  squares: string[];
  daysAtOffice: number;
  daysWfh: number;
  halfDays: number;
  casualLeft: number;
  sickLeft: number;
  annualLeft: number;
  /** Sum of total_hours across the week. */
  weeklyHours: number;
  /** Days the user has total_hours data for. */
  hoursDays: number;
  /** Phase 9 — total work sessions across the week. */
  weekSessions: number;
  appUrl: string;
}

export function buildDigestBlocks(d: DigestData) {
  const dayLine = d.squares.join(" ");
  const labelLine = DAY_LABELS.map((s) => ` ${s} `).join(" ");

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:wave: Hey ${escapeMrkdwn(d.fullName)} — your week in review`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*${longDate(d.weekStartISO)} → ${longDate(d.weekEndISO)}*`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ["```", labelLine, dayLine, "```"].join("\n"),
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*At office*\n${d.daysAtOffice} day${d.daysAtOffice === 1 ? "" : "s"}`,
        },
        {
          type: "mrkdwn",
          text: `*WFH / EWD*\n${d.daysWfh} day${d.daysWfh === 1 ? "" : "s"}`,
        },
        {
          type: "mrkdwn",
          text: `*Half days*\n${d.halfDays}`,
        },
        {
          type: "mrkdwn",
          text: `*Balances left*\nCasual *${d.casualLeft}* · Sick *${d.sickLeft}* · Annual *${d.annualLeft}*`,
        },
      ],
    },
    ...(d.hoursDays > 0
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: hoursSentence(d.weeklyHours, d.hoursDays, d.weekSessions),
            },
          },
        ]
      : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${d.appUrl}/history|See full history →>  ·  <${d.appUrl}/settings|Manage notifications>`,
        },
      ],
    },
  ];
}

function hoursSentence(total: number, days: number, sessions: number): string {
  const totalStr = (Math.round(total * 10) / 10).toFixed(1);
  return `:clock4: You worked *${totalStr} hours* this week across *${days} day${
    days === 1 ? "" : "s"
  }*, with *${sessions} work session${sessions === 1 ? "" : "s"}* total.`;
}

function escapeMrkdwn(s: string): string {
  return s.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
  );
}
