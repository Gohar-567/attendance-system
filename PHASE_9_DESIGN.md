# Phase 9 — Multi-Session Work Tracking

> Extension to BUILD_MANIFEST.md and the Phase 7/8 design docs.
> Replaces the single checkin/checkout model with a multi-session model that supports breaks, flexible hours, and cross-midnight shifts.
> Read this before building. When something is ambiguous, this doc wins for Phase 9.

---

## Why this exists

Real usage feedback from the first week of soft launch revealed the current `checkin_time` / `checkout_time` model doesn't fit how the team actually works:

1. **Flexible hours** — many work 2h WFH morning + 3h gap (travel/client) + 4h office afternoon. Current model logs span = ~9h, real work = 6h.
2. **Night shifts** — some work 4 PM → 2 AM next day. Current model returns NULL or negative hours.
3. **Multiple sessions** — same day, multiple work periods, current model only supports one.
4. **Weekend/holiday entries blocked** — calendar prevents entries on Saturday, Sunday, holidays. Team works extra days, needs to log.
5. **Quick fixes also needed** — weekend reminders, "At office" nudge button, lunch-time reminder cadence.

This phase fixes all of the above with one coherent redesign.

---

## Decisions Locked

Not re-debatable mid-build:

1. **Hours come from sum of sessions, not (checkout - checkin).** Each session = one continuous work period.
2. **Multiple sessions per day allowed.** No limit, but warn if > 5.
3. **A session can cross midnight.** Started Monday 4 PM, ended Tuesday 2 AM = one session, logged on Monday's date, 10 hours.
4. **Sessions belong to the date they started on.** A session that started Sunday 11 PM and ended Monday 7 AM belongs to Sunday's row in reports.
5. **Existing `attendance_logs` table stays** — it represents the *day type* (present/wfh/leave/sick/half). The hours are derived from a new `work_sessions` table.
6. **Slack parser supports multiple checkin/checkout per day.** Each pair creates one session.
7. **Weekend/holiday entries allowed.** Validation that blocked these is removed.
8. **Max session length 16 hours** — anything longer is rejected (likely a missing checkout, surface for review).
9. **Bot does NOT ping on weekends.** Existing weekend filter is broken, fix it.
10. **"At office" button in nudge DM auto-creates a session** — currently it only acknowledges, that's the bug.

---

## Section 9A — Multi-session schema

### New table `work_sessions`

```sql
CREATE TABLE work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_log_id UUID REFERENCES attendance_logs(id) ON DELETE CASCADE,
  -- The date this session "belongs to" (= calendar date of started_at in Asia/Karachi)
  session_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ, -- NULL while session is open
  duration_hours NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN ended_at IS NULL THEN NULL
      WHEN ended_at <= started_at THEN NULL
      WHEN EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600.0 > 16 THEN NULL
      ELSE ROUND(EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600.0, 2)
    END
  ) STORED,
  source TEXT NOT NULL DEFAULT 'web', -- 'web', 'slack', 'nudge_button', 'web_backdated'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT session_end_after_start CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX idx_work_sessions_employee_date 
  ON work_sessions(employee_id, session_date);

CREATE INDEX idx_work_sessions_open
  ON work_sessions(employee_id) 
  WHERE ended_at IS NULL;
```

### attendance_logs.total_hours becomes a sum

Drop the existing trigger. Replace with:

```sql
CREATE OR REPLACE FUNCTION recompute_attendance_hours(p_attendance_id UUID)
RETURNS VOID AS $$
DECLARE
  v_log_type TEXT;
  v_summed NUMERIC;
BEGIN
  SELECT type INTO v_log_type FROM attendance_logs WHERE id = p_attendance_id;
  
  -- Half = 4.0 fixed, leave/sick/holiday = NULL
  IF v_log_type IN ('full_leave', 'sick', 'holiday') THEN
    UPDATE attendance_logs SET total_hours = NULL WHERE id = p_attendance_id;
    RETURN;
  ELSIF v_log_type = 'half_leave' THEN
    UPDATE attendance_logs SET total_hours = 4.0 WHERE id = p_attendance_id;
    RETURN;
  END IF;
  
  -- Present/WFH/EWD = sum of session durations
  SELECT COALESCE(SUM(duration_hours), 0)
  INTO v_summed
  FROM work_sessions
  WHERE attendance_log_id = p_attendance_id
    AND duration_hours IS NOT NULL;
  
  UPDATE attendance_logs
  SET total_hours = CASE WHEN v_summed = 0 THEN NULL ELSE v_summed END
  WHERE id = p_attendance_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger: recompute parent attendance_logs whenever sessions change
CREATE OR REPLACE FUNCTION trigger_recompute_attendance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_attendance_hours(OLD.attendance_log_id);
    RETURN OLD;
  ELSE
    PERFORM recompute_attendance_hours(NEW.attendance_log_id);
    IF TG_OP = 'UPDATE' AND OLD.attendance_log_id IS DISTINCT FROM NEW.attendance_log_id THEN
      PERFORM recompute_attendance_hours(OLD.attendance_log_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_sessions_recompute_hours
  AFTER INSERT OR UPDATE OR DELETE ON work_sessions
  FOR EACH ROW EXECUTE FUNCTION trigger_recompute_attendance();
```

### Migration of existing data

Run as `supabase/multi_session_migration.sql`:

```sql
-- Create new table (above)

-- Backfill from existing checkin_at / checkout_at if any rows have them
INSERT INTO work_sessions (
  employee_id, attendance_log_id, session_date,
  started_at, ended_at, source
)
SELECT
  al.employee_id,
  al.id,
  al.date,
  al.checkin_at,
  al.checkout_at,
  COALESCE(al.source, 'web')
FROM attendance_logs al
WHERE al.checkin_at IS NOT NULL;

-- Recompute total_hours for all attendance_logs that had sessions
SELECT recompute_attendance_hours(id) FROM attendance_logs
WHERE EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.attendance_log_id = attendance_logs.id);

-- Old checkin_at/checkout_at columns are kept for safety net (drop later in v1.2)
-- Add a deprecation comment
COMMENT ON COLUMN attendance_logs.checkin_at IS 'DEPRECATED: use work_sessions instead. Will be dropped in v1.2.';
COMMENT ON COLUMN attendance_logs.checkout_at IS 'DEPRECATED: use work_sessions instead. Will be dropped in v1.2.';
```

---

## Section 9B — Slack parser updates

The parser currently has two intents: `checkin` and `checkout`. Behavior changes:

### Checkin intent

When parser detects checkin (e.g. "checkin 9am", "starting work", "in at 10:30"):

1. Find or create today's `attendance_logs` row (type defaults to 'present')
2. Check for open session: `SELECT FROM work_sessions WHERE employee_id = ? AND ended_at IS NULL`
3. If open session exists from earlier today → DM user: "You already have an open session that started at [time]. Did you mean to check out first?"
4. If open session exists from >12h ago → auto-close it at start time of new session (likely they forgot), warn in DM
5. Otherwise → INSERT new `work_sessions` row with `started_at = parsed_timestamp_or_now`, `ended_at = NULL`
6. React ✅ on the message
7. Log to slack_parse_log

### Checkout intent

When parser detects checkout (e.g. "checkout 6pm", "signing off", "done"):

1. Find the open session for this employee
2. If no open session → DM: "I don't see any open session. Did you forget to check in?"
3. If found → UPDATE `ended_at = parsed_timestamp_or_now`
   - If parsed time < started_at's time-of-day (cross-midnight case) → ended_at uses NEXT calendar day
   - Otherwise → same calendar day
   - Trigger validates max 16h, sets duration_hours to NULL if violated
4. If duration is NULL after update → DM: "That session is over 16 hours, please check the times via the website"
5. React ✅ on the message

### "info_only" intent (WFH, sick, leave, half)

Unchanged. Updates `attendance_logs.type` only, doesn't create sessions.

EXCEPT: if type changes to `wfh`, also allow checkin/checkout commands to create sessions (currently this works, just confirm).

### Weekend / holiday handling

The parser already runs daily — no change in parser, but:
- Remove the **9:30 AM nudge cron's Mon-Fri restriction check** in our code that's broken (probably running every day) — fix it so it actually skips weekends
- Same for checkout reminder

---

## Section 9C — Web UI updates

### Day Detail modal — biggest UI change

**View mode** shows a "Sessions" section with a list:
```
Sessions
  • 9:00 AM – 11:00 AM   (2.0 hrs)
  • 2:00 PM – 6:30 PM    (4.5 hrs)
  Total: 6.5 hrs
```

**Edit mode** (only for own entries + HR can edit anyone):
- Same session list, each row has an edit pencil + delete trash
- "Add session" button at the bottom
- Add/Edit row: datetime-local input for start, datetime-local input for end (allows past dates for cross-midnight)
- Live total updates as you type
- Save button → submits all changes (added/updated/deleted sessions) in one server action
- Validation: end > start, duration ≤ 16h

### Backdate adding sessions
When backdating attendance (Phase 7 feature), the modal lets you add sessions for that past date. Same UI.

### Calendar cells
- Same color coding as before (green present, blue WFH, etc.)
- Hours number in bottom-right is now the **sum of session durations**
- Multi-session days look the same as before — just one cell with the total

### "Hours This Week" card
Sum of all session durations within current week (Mon-Sun), grouped by session_date (which equals the start date — so cross-midnight sessions count for the day they started).

### Weekend/Holiday entry support
Currently the calendar blocks clicking Saturday, Sunday, holidays. Change:
- Allow click → modal opens normally → can add sessions
- New visual: weekend/holiday cells get a subtle background color (slightly muted) but are still clickable
- Show "Weekend" or "[Holiday name]" badge in the modal header so people know

---

## Section 9D — "At office" nudge button fix

Current bug (Faizan's report): clicking "At office" in the 11 AM nudge DM doesn't record anything unless the user also posts in #attendance.

Root cause: the button handler in `/api/slack/interactions` only sends a confirmation message — doesn't actually create the attendance_logs row + work_session.

Fix:
1. When user clicks "At office":
   - Create today's attendance_logs row (type=present) if it doesn't exist
   - Create a work_sessions row with started_at = now, ended_at = NULL
   - DM confirmation: "Logged you in at [time]. Reply 'checkout' or post in #attendance when you finish."
2. When user clicks "WFH":
   - Same, but type=wfh
3. When user clicks "Half day morning" or "Half day afternoon":
   - Set type=half_leave, half=first_half or second_half
   - No work_session created (half = fixed 4 hours)
4. When user clicks "Sick":
   - Set type=sick
   - No work_session
5. Each button click writes to audit_log

---

## Section 9E — Cron fixes

### 11 AM checkin nudge

Existing endpoint at `/api/cron/checkin-reminder`. Bug: it's running on weekends.

Fix:
1. Add at the top of the handler:
   ```ts
   const today = todayInKarachi(); // returns Date
   const dayOfWeek = getDayOfWeek(today); // 0=Sun, 6=Sat
   if (dayOfWeek === 0 || dayOfWeek === 6) {
     return NextResponse.json({ skipped: 'weekend' });
   }
   ```
2. Also check holidays table:
   ```ts
   const isHoliday = await checkHoliday(today);
   if (isHoliday) return NextResponse.json({ skipped: 'holiday' });
   ```

Additionally, Afnan asked for the timing change. Per the existing decision (Phase 8), the time is 11 AM. Keep that for now unless team consensus changes — we'll review again in 2 weeks.

### 9 PM checkout reminder

Same weekend/holiday guards. Same time stays 9 PM PKT.

### Skip employees with no open session
Existing logic: reminder fires for employees with open sessions older than 4h. Keep that. The point is to ping people who forgot to check out, not nag everyone.

### Skip night-shift employees from morning nudges
If an employee has an open session that started ≥ 8 hours ago (i.e., they're mid-overnight-shift), skip the morning nudge for them — they're working, don't interrupt.

---

## Section 9F — Reports & exports

These mostly work because they read `total_hours` (which now sums sessions correctly). Light updates needed:

### Monthly report
- Avg hrs/day = total_hours / days_worked. Stays correct.
- Total hrs = sum. Stays correct.
- Add a new column: **Sessions/day** = average sessions per day worked (signals how flexible someone's schedule is)

### Excel export (Details sheet)
- Replace single "Check-in" / "Check-out" columns with **"Sessions"** column showing comma-separated list:
  ```
  9:00-11:00, 2:00-6:30
  ```
- Or three columns: First Checkin, Last Checkout, Total Sessions

### /admin/hours page
- Same table, but add a column: "# sessions" so HR can see who has fragmented days

### Weekly digest
- Update Sunday digest text to: "You worked X hours this week across Y days, with Z work sessions total"

---

## Edge cases handled

| Case | Behavior |
|---|---|
| Person checks in but never checks out | Session stays open (ended_at NULL). 9 PM cron DMs them. They can still get logged via website edit. |
| Person checks in twice without checking out | First "open session exists" warning fires. Second checkin rejected. |
| Person checks out without ever checking in | "No open session" DM fires. They use website to add manually. |
| Cross-midnight session | Started 11 PM Mon, ended 2 AM Tue = 3h session, logged on Monday's date. Tuesday gets its own row if they work again. |
| Edit a session to span midnight | Allowed. Trigger handles ended_at > started_at correctly with TIMESTAMPTZ math. |
| Three sessions same day | All three logged, total_hours = sum of all three. |
| 16+ hour session | duration_hours = NULL. UI shows "—". HR investigates. |
| Weekend extra work | Allowed. attendance_logs row created with date = Saturday. Sessions logged. Counts in monthly report. |
| Holiday work | Same as weekend. |
| Half-day + sessions | Conflicting — UI prevents adding sessions if type = half_leave. |
| Leave day + checkin Slack message | Bot DMs: "You're marked on leave today. Cancel leave first if you're actually working." |

---

## Build Order

Single PR — too entangled to split. Estimated 5-7 days of Claude Code work.

1. Migration: create `work_sessions` table, backfill, replace trigger
2. Server actions: create/update/delete work session
3. Slack parser: rewrite checkin/checkout intents to use work_sessions
4. Slack events handler: route to new parser logic
5. Nudge button handler fix (Faizan's bug)
6. Day Detail modal: sessions list + add/edit/delete UI
7. Hours-this-week card update
8. Calendar weekend/holiday unblock
9. Cron weekend/holiday skip guards
10. Monthly report + Excel exports updates
11. /admin/hours page session count column
12. Weekly digest text update

Tests required:
- Migration preserves all existing data (compare row counts before/after)
- Hours computed correctly for single-session days (regression test)
- Multi-session day sums correctly
- Cross-midnight session logs correctly
- Weekend entries allowed
- Bot skips weekends/holidays
- "At office" button creates session correctly

---

## What we are NOT building (still)

Same exclusions as before, plus:
- ❌ Break "approval" workflow
- ❌ Minimum/maximum break enforcement
- ❌ Productivity tracking during sessions
- ❌ Auto-detect breaks (e.g. "you were idle for 30 min")
- ❌ Sub-session intervals (just start/end pairs)
- ❌ Multiple checkouts queued (one open session at a time)

---

## Testing Checklist

### Migration
- [ ] All existing checkin_at/checkout_at pairs become work_sessions rows
- [ ] total_hours unchanged for rows that had single session
- [ ] No data loss

### Multi-session
- [ ] Create attendance_logs row, add 2 sessions, total = sum
- [ ] Delete a session → total recomputed
- [ ] Edit a session time → total recomputed
- [ ] 3 sessions same day → all logged, sum correct

### Cross-midnight
- [ ] Slack: "checkin 11pm" → session created, started_at = today 11 PM
- [ ] Next day "checkout 7am" → ended_at = today 7 AM (NOT yesterday), 8h duration
- [ ] Calendar shows the session on the start date

### Bug fixes
- [ ] Faizan's "At office" button creates a session (not just a confirmation)
- [ ] Bot doesn't ping on Saturday or Sunday
- [ ] Bot doesn't ping on holidays
- [ ] Can add manual entry on Saturday from calendar
- [ ] Can add manual entry on a holiday from calendar

### Edge cases
- [ ] Two checkins in a row → second one rejected with helpful DM
- [ ] Checkout with no open session → helpful DM
- [ ] 16+ hour session → duration_hours = NULL, UI shows "—"

---

*End of Phase 9 spec.*
