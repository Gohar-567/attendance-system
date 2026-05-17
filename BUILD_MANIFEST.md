# Attendance System — Build Manifest

> Source of truth for building this. Designed in Claude, built in Claude Code.
> Read this before writing any code. When something is ambiguous in implementation, this doc wins.

---

## 1. The Problem in One Paragraph

A 30-person team logs daily attendance in Slack `#attendance`. HR manually copies messages into Excel — slow, error-prone, and answering "what's my balance?" eats her day. Solution: a Slack bot that auto-parses messages, a database that holds attendance + leave balances, a web dashboard so every employee sees their own data, and an HR dashboard that replaces the Excel sheet entirely.

**Constraints:** small team, two builders (the user + Claude Code), free-tier infra preferred, must ship in a few weekends not months.

---

## 2. Stack (Final)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript | One codebase: web UI, API routes, Slack bot, cron jobs |
| Styling | Tailwind + shadcn/ui | Fast, mobile-friendly, matches the mockups |
| Database | Supabase (Postgres) | Free tier, auth built in, RLS for multi-role permissions |
| Auth | Supabase Auth via Slack OAuth | Employees sign in with Slack — no extra password to manage |
| Slack | Slack Bolt SDK | Official, well-supported, handles Events + Slash Commands + Modals |
| AI fallback | Anthropic API (`claude-sonnet-4-6`) | Parses messy Slack messages when regex isn't sure |
| Hosting | Vercel | Free tier covers 30 users; auto-deploys from git |
| Cron | Vercel Cron Jobs | Daily nudges + Sunday digests |
| Excel export | `exceljs` npm package | xlsx generation in API route |

**Total cost target:** $0/month for the first year. All free tiers.

---

## 3. Decisions Locked

These are not negotiable in v1. Changing them mid-build = wasted code.

### Leave types
- **Casual** — default 10 days/year
- **Sick** — default 8 days/year
- **Annual** — default 14 days/year
- **WFH** — unlimited, doesn't deduct from any balance
- **EWD** (External Work Day) — unlimited, doesn't deduct
- **Half leave** — counts as 0.5 day against whichever leave type used

### Approval rules
- **WFH, EWD, Half** → auto-logged, no approval needed
- **Full leave** (any type, 1+ full days) → requires approval
- Approval routes to **employee's team lead**
- If employee **is** a team lead → routes to HR
- If team has **no lead set** → routes to HR
- After **48 hours pending** → auto-escalates to HR
- Lead can approve from Slack DM **or** web — same outcome

### Roles
- **employee** — sees only own data
- **team_lead** — sees own team, approves their team's leaves
- **hr** — sees everything, approves everything, manages employees
- **admin** — same as HR + can change roles and system settings

### Working week
- Mon–Fri are working days
- Sat–Sun are weekends, don't count for or against attendance
- Public holidays (`holidays` table) also excluded

### Pro-rated annual leave
- New hires get `floor(annual_allowance × months_remaining_in_year / 12)`
- Casual and Sick do NOT pro-rate (people get sick year-round)

---

## 4. Data Model

The full SQL is in `attendance_schema.sql` (paste into Supabase SQL Editor). Summary:

| Table | Purpose |
|---|---|
| `teams` | Engineering, Design, Sales, etc. Each can have one lead. |
| `employees` | Name, email, slack_user_id, team, role, allowances (JSON), join_date |
| `attendance_logs` | One row per employee per day. Source of truth for everything. UNIQUE on (employee_id, date). |
| `leave_requests` | Only for full leaves needing approval. Approved → writes to attendance_logs. |
| `holidays` | Public holidays. Auto-excluded from working-day calculations. |
| `slack_parse_log` | Every Slack message the bot processed + what it extracted. Used for debugging + tuning. |
| `audit_log` | Sensitive ops only (approvals, balance edits, manual overrides). |

Two views:
- `v_employee_balances` — live-computed leave balances. Never stored, never drifts.
- `v_today_status` — today's row for everyone. Powers the HR team grid.

---

## 5. Screens (12 designed)

Each was mocked in Claude. Reference the mockups when implementing.

### Employee
1. **Dashboard** — today banner, 4 balance cards, color-coded month calendar, quick actions
2. **My history** — full lifetime table, filter chips, lifetime totals, CSV export
3. **Day detail modal** — what shows when tapping any calendar cell, with audit trail
4. **Request leave form** — type + date range + live balance preview + conflict warnings
5. **Empty / onboarding** — first-login state with bot connection CTA

### Team lead
6. **Lead view** — same as HR but scoped to their team only, no admin tools

### HR
7. **HR dashboard** — 5-tile snapshot, pending approvals queue, parser stats, team grid
8. **Monthly report** — per-employee row with all metrics + 3 KPI cards + Excel export
9. **Manage employees** — add/edit/deactivate, set teams + leads + custom allowances

### Slack
10. **Channel auto-log** — react ✅ for high confidence, threaded reply for low confidence
11. **DM digests** — Sunday weekly summary + 9:30 AM daily nudge if unmarked
12. **Approval DM** — leave details + Approve / Reject buttons + auto-conflict check

### Mobile
All employee + HR screens have mobile layouts. 2-col grids replace 4-col, calendars become color blocks, HR gets a bottom nav.

---

## 6. Slack Bot Logic

### Inbound message flow

```
Message in #attendance
  ↓
Lookup slack_user_id → employees row (auto-create if first time, flag for HR)
  ↓
Try regex parser
  ├─ Confidence ≥ 0.85 → write attendance_log, react ✅, post small confirmation pill
  └─ Confidence < 0.85 → call Claude API
                          ├─ Confidence ≥ 0.80 → write log + post threaded "I read this as..." with ✅/❌ reactions
                          └─ Confidence < 0.80 → DM employee asking for /attendance command
  ↓
Log everything to slack_parse_log regardless of outcome
```

### Regex patterns (starting set)

| Phrase pattern | Maps to | Confidence |
|---|---|---|
| `wfh`, `WFH`, `working from home` | wfh, full | 0.95 |
| `half day`, `half leave`, `1/2 day` | half_leave, full | 0.85 |
| `morning off`, `first half off` | half_leave, first_half | 0.90 |
| `afternoon off`, `second half off` | half_leave, second_half | 0.90 |
| `sick today`, `not feeling well` | sick, full | 0.85 |
| `on leave`, `taking leave`, `casual leave` | full_leave, full | 0.80 |
| `ewd`, `client visit`, `at client` | ewd, full | 0.90 |

Add patterns as you observe team's actual phrasing in `slack_parse_log`.

### Claude API prompt (for fallback)

```
You parse Slack messages from a team's #attendance channel.

Message: "{raw_text}"
Sender: {employee_name}
Date posted: {date}

Return ONLY JSON, no prose:
{
  "type": "wfh" | "ewd" | "half_leave" | "full_leave" | "sick" | "present" | "unclear",
  "half": "full" | "first_half" | "second_half",
  "date": "YYYY-MM-DD",  // default to today if unspecified
  "reason": "string or null",
  "confidence": 0.0-1.0
}

Rules:
- "kid is sick, taking morning off" → half_leave, first_half
- "wfh" alone → wfh, full
- "out today, food poisoning" → sick, full
- If you can't tell → "unclear", confidence < 0.5
```

Model: `claude-sonnet-4-6`. Max tokens 200. Temperature 0.

### Slash command `/attendance`

Opens a Slack modal:
- Type dropdown (full leave, half leave first/second, WFH, EWD, sick)
- Date picker (default today, allow backdating up to 30 days)
- Reason text input (optional)
- Submit → writes to attendance_logs (or leave_requests if full leave)

---

## 7. API Routes

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/auth/slack/callback` | GET | Slack OAuth | Public |
| `/api/slack/events` | POST | Slack Events API webhook | Slack signature |
| `/api/slack/commands` | POST | Slash command handler | Slack signature |
| `/api/slack/interactions` | POST | Button clicks, modal submits | Slack signature |
| `/api/attendance` | POST | Log/update attendance | User session |
| `/api/attendance/[id]` | DELETE | Soft-delete (creates audit row) | User session, owner or HR |
| `/api/leave-requests` | POST | Submit leave request | User session |
| `/api/leave-requests/[id]/decide` | POST | Approve/reject | Approver (lead or HR) |
| `/api/employees` | GET, POST | List + create | HR/admin |
| `/api/employees/[id]` | PATCH | Edit | HR/admin |
| `/api/export?month=YYYY-MM` | GET | xlsx download | HR/admin |
| `/api/cron/daily-nudge` | POST | 9:30 AM nudges | Vercel cron secret |
| `/api/cron/weekly-digest` | POST | Sunday 7 PM digests | Vercel cron secret |

---

## 8. Row Level Security (Supabase)

```sql
-- Employees see only their own attendance
CREATE POLICY "own_attendance" ON attendance_logs
  FOR SELECT USING (employee_id = auth.uid());

-- Team leads see their team's attendance
CREATE POLICY "team_attendance" ON attendance_logs
  FOR SELECT USING (
    employee_id IN (
      SELECT e.id FROM employees e
      JOIN teams t ON e.team_id = t.id
      WHERE t.lead_id = auth.uid()
    )
  );

-- HR/admin see everything
CREATE POLICY "hr_all_attendance" ON attendance_logs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role IN ('hr', 'admin'))
  );

-- Similar pattern for leave_requests, employees, etc.
```

Claude Code should generate the full RLS policy set as part of the auth setup.

---

## 9. Build Order (Recommended)

Build in this order. Each phase should be testable on its own.

### Phase 1 — Foundation (1 weekend)
1. Next.js project, TypeScript, Tailwind, shadcn/ui
2. Supabase project, paste schema, enable RLS
3. Supabase Auth via Slack OAuth, basic login flow
4. Seed: 3 teams, 5 test employees, yourself as HR

**Done when:** you can log in with Slack and see your name in a `/me` page.

### Phase 2 — Employee dashboard (1 weekend)
5. Employee dashboard (screen 1)
6. Day detail modal (screen 3)
7. My history view (screen 2)
8. Empty / onboarding state (screen 5)

**Done when:** you can manually insert attendance rows in Supabase and see them on your dashboard.

### Phase 3 — Slack bot core (1 weekend)
9. Slack app setup (events, commands, scopes)
10. `/api/slack/events` — receive + verify + log to slack_parse_log
11. Regex parser → write attendance_logs
12. Reaction-based confirmation flow
13. `/attendance` slash command + modal

**Done when:** posting "WFH today" in `#attendance` shows up on your dashboard.

### Phase 4 — Leave requests + approval (1 weekend)
14. Request leave form (screen 4)
15. Leave request → notify approver (web + Slack DM)
16. Approval DM with buttons (screen 12)
17. On approve → write attendance_logs rows for date range
18. Auto-escalation cron (48h)

**Done when:** you can submit a leave on the web, approve it from Slack DM, and see it on your calendar.

### Phase 5 — HR + lead views (1 weekend)
19. HR dashboard (screen 7)
20. Team lead view (screen 6)
21. Manage employees (screen 9)
22. Monthly report + Excel export (screen 8)

**Done when:** HR can see everyone, approve leaves, and download a monthly report.

### Phase 6 — Polish (1 weekend)
23. Sunday weekly digest cron
24. Daily nudge cron
25. Claude API parser fallback (only after seeing real Slack messages for 1 week)
26. Mobile layout pass
27. Error states, loading states, edge cases

**Done when:** ready to invite the team.

### Deferred to v2
- Annual leave year rollover logic (start of next year)
- Per-employee custom holiday calendars
- Manager comments on attendance entries
- Slack channel daily summary post
- Mobile push notifications

---

## 10. Environment Variables

Create these in `.env.local` (and in Vercel project settings):

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # server-side only, never expose

# Slack
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=               # xoxb-...
SLACK_APP_TOKEN=               # xapp-... (only if using Socket Mode in dev)
SLACK_ATTENDANCE_CHANNEL_ID=   # the #attendance channel ID

# Anthropic (parser fallback)
ANTHROPIC_API_KEY=

# Cron
CRON_SECRET=                   # any random string, used to verify Vercel cron calls

# App
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

---

## 11. External Accounts to Set Up (Before Coding)

### Supabase (5 min)
1. supabase.com → New project
2. Region: closest to Lahore (probably Singapore)
3. Save: Project URL, anon key, service role key
4. SQL Editor → paste `attendance_schema.sql` → Run
5. Authentication → Providers → enable Slack, paste credentials when ready

### Slack app (15 min)
1. api.slack.com/apps → Create New App → From scratch
2. App name: `Attendance Bot`, Workspace: yours
3. **OAuth & Permissions** → Bot Token Scopes:
   - `channels:history` (read #attendance messages)
   - `chat:write` (post replies + DMs)
   - `commands` (slash commands)
   - `reactions:write` (the ✅ reaction)
   - `users:read` + `users:read.email` (link Slack users to employees)
   - `im:write` (send DMs)
4. **Event Subscriptions** → enable, request URL: `{NEXT_PUBLIC_APP_URL}/api/slack/events`
   - Subscribe to: `message.channels` (filter to attendance channel in code)
5. **Slash Commands** → Create `/attendance`, request URL: `{NEXT_PUBLIC_APP_URL}/api/slack/commands`
6. **Interactivity** → enable, request URL: `{NEXT_PUBLIC_APP_URL}/api/slack/interactions`
7. Install to workspace, save Bot Token (`xoxb-...`)

### Anthropic API (2 min)
1. console.anthropic.com → API Keys → Create
2. Add minimum credit ($5 will last months for 30 people)
3. Save key

### Vercel (3 min)
1. vercel.com → Connect GitHub
2. Import the repo (later, after Phase 1)
3. Add all env vars in Project Settings
4. Set up Cron Jobs in `vercel.json`:
   ```json
   {
     "crons": [
       { "path": "/api/cron/daily-nudge", "schedule": "30 9 * * 1-5" },
       { "path": "/api/cron/weekly-digest", "schedule": "0 19 * * 0" }
     ]
   }
   ```
   (Pakistan time = UTC+5; adjust schedules to Vercel's UTC.)

---

## 12. Claude Code Prompt Sequence

Use these prompts in order, one per phase. Each assumes you've completed the previous phase.

### Initial setup prompt

> I'm building an attendance system. The full design + decisions are in `BUILD_MANIFEST.md` and the Postgres schema is in `attendance_schema.sql`. Both are in the project root. Read them first.
>
> Stack: Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui + Supabase + Slack Bolt SDK. Deploy to Vercel.
>
> For this session, do Phase 1 only:
> 1. Initialize the Next.js project, install all dependencies, configure shadcn/ui.
> 2. Set up Supabase clients (browser + server) using `@supabase/ssr`.
> 3. Implement Slack OAuth login via Supabase Auth.
> 4. Write the RLS policies for all tables based on Section 8 of the manifest.
> 5. Create a basic `/me` page that shows the logged-in employee's name and team.
>
> Stop after Phase 1 and let me test it.

### Phase 2 prompt
> Phase 2 from BUILD_MANIFEST.md. Build the employee dashboard, day detail modal, my history view, and onboarding state. Match the visual structure from our designs: today banner, 4 balance cards, color-coded calendar (green=present, blue=WFH, amber=half, red=leave, gray=off, dashed=future), 3 quick action buttons. Make it mobile-responsive (2-col stat grid below 640px).

### Phase 3 prompt
> Phase 3 from BUILD_MANIFEST.md. Build the Slack bot. Use Section 6 for the regex patterns and parsing flow. Implement message events, the slash command, and the reaction-based confirmation. Skip the Claude API fallback for now — we'll add it in Phase 6 after seeing real messages.

### Phase 4 prompt
> Phase 4 from BUILD_MANIFEST.md. Build leave requests + approval. Web form with live balance preview and conflict detection. Slack DM with Approve/Reject buttons that match the mockup. On approve, expand the date range into individual attendance_logs rows. Add the 48h auto-escalation cron.

### Phase 5 prompt
> Phase 5 from BUILD_MANIFEST.md. Build HR dashboard, team lead view, manage employees, monthly report. Use the `v_today_status` and `v_employee_balances` views. Excel export uses `exceljs` and matches the column structure of the monthly report.

### Phase 6 prompt
> Phase 6 from BUILD_MANIFEST.md. Add the cron jobs (daily nudge + Sunday digest), the Claude API parser fallback (use `claude-sonnet-4-6`, prompt in Section 6), and a mobile pass on every screen. Then I'll start onboarding my team.

---

## 13. Testing Checklist (Per Phase)

Don't skip. Each item costs 30 seconds and saves hours.

### After Phase 1
- [ ] I can log in with Slack
- [ ] My employee row exists with correct slack_user_id
- [ ] RLS blocks me from seeing other people's data via direct SQL

### After Phase 2
- [ ] My calendar shows colors for past days I manually inserted
- [ ] Tapping a day opens the modal with audit info
- [ ] Mobile layout doesn't break at 380px width

### After Phase 3
- [ ] Posting "WFH today" in #attendance gets a ✅ reaction within 3 seconds
- [ ] Posting "kid is sick" gets a threaded clarification (low confidence)
- [ ] `/attendance` opens the modal and submits correctly
- [ ] Every message creates a slack_parse_log row

### After Phase 4
- [ ] Submitting a 5-day leave creates 1 leave_request row, not 5 attendance_logs
- [ ] My team lead gets a Slack DM
- [ ] Approving from the DM creates 5 attendance_logs rows (skipping weekends)
- [ ] Conflict detection correctly flags overlapping leaves

### After Phase 5
- [ ] HR sees all 30 employees in team grid
- [ ] Team lead sees only their team
- [ ] Excel export opens cleanly in Excel + matches the on-screen monthly report
- [ ] Adding a new employee + setting their team works end-to-end

### After Phase 6
- [ ] Sunday digest DM arrives at 7 PM (test with a fake schedule first)
- [ ] Daily nudge only sends to people without an entry that day
- [ ] Claude API fallback handles 5 deliberately weird messages correctly

---

## 14. Things That Will Go Wrong (and How to Handle)

### "The bot isn't reading my messages"
- Check Event Subscriptions URL is verified in Slack
- Check the bot is *invited* to `#attendance` (`/invite @attendance-bot`)
- Check `slack_parse_log` — if empty, the events webhook isn't being hit

### "RLS is blocking my legitimate query"
- Use `supabaseAdmin` (service role key, server-side only) for system operations
- Never expose service role key to the browser
- Test policies in Supabase SQL Editor with `SET LOCAL role authenticated; SET LOCAL request.jwt.claim.sub = 'user-uuid'`

### "Cron isn't firing"
- Vercel crons run in UTC. Pakistan is UTC+5, so 9:30 AM PKT = 4:30 AM UTC = `30 4 * * 1-5`
- They only run on production deployments, not preview
- Check Vercel logs

### "Parser is wrong too often"
- Don't tweak regex blindly. Run `SELECT raw_text, parsed_type, confidence FROM slack_parse_log WHERE confidence < 0.8 ORDER BY created_at DESC LIMIT 50` and look at actual patterns
- Add patterns one at a time, ship, observe again

### "Someone's balance looks wrong"
- It's a view (`v_employee_balances`) — never stored. So the bug is upstream.
- Check `leave_requests` for that employee filtered to current year + status='approved'
- The math: `allowance - sum(to_date - from_date + 1)` per leave type

---

## 15. After Launch

### Week 1 with team
- Watch `slack_parse_log` daily, add regex patterns for phrases you missed
- HR will find 2-3 things she wishes were different — list them, ship in a v1.1
- Don't promise features until you've seen the real usage pattern

### Month 1
- Annual leave rollover logic (decide policy: lapse, carry-forward N, encash)
- Per-team dashboards if leads want them
- Optional: a dedicated mobile app shell (PWA) for one-tap home-screen access

### Things to NOT add
- Geolocation check-ins (creepy, low value)
- Photo verification (creepy)
- Time tracking (different problem entirely, don't conflate)
- Performance metrics tied to attendance (will damage trust in the system)

The system's value is **visibility + automation**, not **surveillance**. Keep it that way.

---

## 16. Quick Reference: File Pairing

When you start the build, you'll have these in your project root:

| File | Purpose |
|---|---|
| `BUILD_MANIFEST.md` (this file) | Source of truth for all decisions |
| `attendance_schema.sql` | Database structure, paste into Supabase once |
| `.env.local` | Secrets (you create this) |
| `vercel.json` | Cron schedule + build config |

Read the manifest. Run the SQL. Set up the accounts in Section 11. Then start Phase 1.

---

## 17. Welcome Announcement Template

> Copy-paste snippet HR can send each new hire after creating their employees row. Covers all three login methods introduced through Phases 1, 7, and 8A.

```
Hey [Name] —

You're all set up on the attendance system. Sign in at https://[your-app].vercel.app/login using any of these:

  • Continue with Slack (one-click; uses your workspace SSO).
  • Email + password — if HR issued you a temporary one, you'll be asked
    to pick your own on first login.
  • "Get a magic link" — type your work email, click the button, then
    click the link we send to your inbox. The link expires in 1 hour.

Forgot your password later? There's a "Forgot password?" link on the
sign-in page that emails you a reset link.

If you don't see any of the emails, check spam. Reach out to HR if
you're still stuck.
```

---

*End of manifest. Reach back to Claude (chat) for new design decisions, schema changes, or strategy. Use Claude Code for implementation.*
