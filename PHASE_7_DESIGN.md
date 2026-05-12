# Phase 7 Update — Hours Tracking + Self-Edit + Global Nav

> Extension to the original BUILD_MANIFEST. Adds three updates based on real usage feedback.
> Read this before building. When something is ambiguous in implementation, this doc wins for Phase 7 only — earlier phases stay as they were.

---

## What's changing

| Update | Scope |
|---|---|
| 7A — Global navigation | Header on every page; mobile hamburger |
| 7B — Self-edit attendance | Employees edit their own entries; HR edits anyone's |
| 7C — Hours tracking | Check-in / check-out times; computed hours; HR aggregates |

These ship as one combined update, but split into 2 PRs for review sanity:
- **PR 1:** 7A + 7B (nav + self-edit) — low risk, immediate value
- **PR 2:** 7C (hours) — schema + parser + UI

---

## Decisions Locked

These come from the conversation. Not re-debatable in code:

1. **Single shift per day.** One check-in, one check-out. No lunch tracking, no multi-session.
2. **Half day = 4 hours fixed.** Check-in/out on a half-day entry is recorded but the system uses 4.0 as the hours value regardless.
3. **No thresholds, no alerts.** Numbers are displayed, never flagged. HR judges from the data, not from system warnings.
4. **WFH and EWD also track check-in/out.** Same as office days. If the user prefers not to, they can leave times blank — entry still counts as WFH/EWD with hours = NULL (shown as "—").
5. **Full leave / sick days = no check-in/out.** Hours = NULL.
6. **No expected-start-time enforcement.** Numbers are descriptive, not prescriptive. No "late" flag.
7. **Employees can edit their own attendance.** Approved full-leave entries are locked (HR only).
8. **Audit log on every edit.** Who changed what, when.

---

## 7A — Global Navigation

### Spec
Every page renders the same header (`TopBar` component, extended). On desktop, all items inline. On mobile (`<640px`), collapse into a hamburger menu.

### Menu structure (role-aware)

**Always visible:**
- My profile (→ `/me`)
- My calendar (→ `/`)
- My history (→ `/history`)
- My leaves (→ `/leave`)
- Request leave (→ `/leave/new`)

**Visible to `team_lead` and above:**
- Approvals (→ `/approvals`)
- Team view (→ `/admin/team`) — leads only

**Visible to `hr` and `admin`:**
- Admin (→ `/admin`)
- Reports (→ `/admin/report`)
- Manage employees (→ `/admin/employees`)
- Manage teams (→ `/admin/teams`)
- Parser log (→ `/admin/parser-log`)
- **NEW:** Hours overview (→ `/admin/hours`)

**Right side, always:**
- Settings gear (→ `/settings`)
- Sign out

### Mobile
Hamburger icon at top-right. Slide-out drawer with all items in single column. Sticky header.

### Active state
Current route gets visual highlight (matches existing TopBar pattern).

---

## 7B — Self-Edit Attendance

### Spec

#### Day Detail modal (existing) — additions
- Add **Edit** button (visible to row's owner + HR/admin)
- Add **Delete** button (HR/admin only; employees can't delete, only edit)
- "Edit" opens an inline form within the modal:
  - Type (radio): Present, WFH, EWD, Half leave, Sick
  - Half (radio, only if type=Half leave): First half, Second half
  - Reason (textarea, optional)
  - Check-in time (only if type ∈ {Present, WFH, EWD})
  - Check-out time (only if type ∈ {Present, WFH, EWD})
  - Save / Cancel
- On Save: UPDATE `attendance_logs`, write `audit_log` entry (action: `attendance_edited`, details: old + new values), close modal, refresh calendar.

#### Backdated entries (new flow)
- Calendar cells for past days *with no entry* (empty cells, not weekends/holidays) become clickable.
- Click → "Add entry for May 7" modal. Same form as edit.
- Save → INSERT new `attendance_logs` row with source = `'web_backdated'`.
- Audit log entry: `attendance_added_backdated`.

#### Locked entries
Employees **cannot edit**:
- Entries where `source = 'leave_request'` AND `status = 'approved'` (full leaves came through approval; editing them would silently bypass the approval flow)
- The Edit button is hidden for these. Tooltip: *"This entry came from an approved leave request. Ask HR to change it."*

HR/admin can edit anything.

#### Calendar UX
- Past empty weekday cells show a faint **+** icon on hover
- Today's cell still has the colored ring + click-to-edit
- Future cells stay dashed and not clickable

### Audit log
Every edit/add/delete writes a row to `audit_log` with `action`, `actor_id`, `target_type = 'attendance_log'`, `target_id`, and `details` containing `{ before: {...}, after: {...} }`.

---

## 7C — Hours Tracking

### Schema changes

Run as `supabase/hours_tracking.sql`:

```sql
-- Add columns to attendance_logs
ALTER TABLE attendance_logs
  ADD COLUMN checkin_time TIMETZ,        -- e.g. 09:30:00+05
  ADD COLUMN checkout_time TIMETZ,
  ADD COLUMN total_hours NUMERIC(4,2);   -- computed; nullable for leave days

-- Index for HR queries
CREATE INDEX idx_attendance_logs_hours
  ON attendance_logs(date, total_hours)
  WHERE total_hours IS NOT NULL;

-- Compute total_hours based on type rules
CREATE OR REPLACE FUNCTION compute_total_hours()
RETURNS TRIGGER AS $$
BEGIN
  -- Full leave / sick → NULL (not working)
  IF NEW.type IN ('full_leave', 'sick', 'holiday') THEN
    NEW.total_hours := NULL;
  -- Half leave → fixed 4.0
  ELSIF NEW.type = 'half_leave' THEN
    NEW.total_hours := 4.0;
  -- Present, WFH, EWD → compute from check-in/check-out if both present
  ELSIF NEW.checkin_time IS NOT NULL AND NEW.checkout_time IS NOT NULL THEN
    NEW.total_hours := EXTRACT(EPOCH FROM (NEW.checkout_time - NEW.checkin_time)) / 3600.0;
    -- Clamp negative or absurd values
    IF NEW.total_hours < 0 OR NEW.total_hours > 16 THEN
      NEW.total_hours := NULL;
    END IF;
  ELSE
    NEW.total_hours := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_compute_hours
  BEFORE INSERT OR UPDATE ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION compute_total_hours();
```

This way `total_hours` is always correct without app-side calculation. Trigger handles every case.

### Slack parser additions

Add these patterns to `lib/slack/parser.ts`:

| Pattern | Maps to | Behavior |
|---|---|---|
| `checkin 9:30am` / `check in 9:30` / `in at 9:30` / `started at 9:30` | type=present, checkin_time=09:30 | UPSERT: if row exists for today, update checkin_time only |
| `checkout 6pm` / `check out 18:00` / `signing off 6pm` / `done for the day` | (update existing row) | UPDATE: set checkout_time only |
| `wfh checkin 9:30` / `wfh 9:30` | type=wfh, checkin_time=09:30 | UPSERT |
| `checkin` (no time) | type=present, checkin_time=NOW() | UPSERT |
| `checkout` (no time) | (update existing) | UPDATE: checkout_time=NOW() |

**Time parsing:**
- Support: `9am`, `9:30am`, `9:30`, `09:30`, `10:30pm`, `noon`, `midnight`
- Default if hour < 8 → assume PM (typo guard for "checkout 6" meaning 6pm)
- All times stored as TIMETZ in Asia/Karachi timezone

**Behavior nuance:**
- If user posts "WFH 9:30am" — bot logs both type=wfh AND checkin_time=09:30 in one row.
- If they post "checkin 9:30" in morning then "checkout 6pm" in evening — same row, two updates.
- If they post "checkout 6pm" without ever checking in — bot DMs them: *"You haven't checked in today. Use /attendance to set both times."*

### UI additions

#### Employee dashboard `/`
- Today banner expands to show **check-in / check-out** if logged today, plus computed hours.
  - Before checkin: "You haven't checked in today" + a "Check in now" button
  - After checkin, before checkout: "Checked in at 9:32 AM" + "Check out" button
  - After both: "Checked in 9:32 AM · Checked out 6:14 PM · 8.7 hours"
- Calendar cells show small hour number in bottom-right when total_hours is set
  - Just the number: `8.7`, `4` (for half), nothing for leave days
- 4 balance cards stay the same (Casual / Sick / Annual / WFH this month)
- New card or extension: "Hours this week" — current week's total (cumulative as the week progresses)

#### `/history`
Add three columns: **Check-in**, **Check-out**, **Hours**.
CSV export includes these.
Filter chips include "Hours < 6" toggle (for self-discovery, not flagging).

#### Day Detail modal (extends 7B)
When editing: time pickers for check-in / check-out. Total hours displays live as user changes times.

#### HR aggregates — NEW `/admin/hours` page
Table per employee:
- Name, Team
- Hours today (or `—`)
- Hours this week (sum)
- Hours this month (sum)
- Avg hours/day this month
- Days worked this month

Sortable. Filter by team. Date-range picker (last 7 / 30 / custom).
Export to Excel.

#### `/admin/report` (existing monthly report) — add columns
- **Avg hours/day** column
- **Total hours** column
Existing Excel export gets these too.

#### Sunday digest — add hours
Weekly digest DM now includes: *"You worked 38.5 hours this week (5 days, avg 7.7 hours/day)"*

---

## Edge cases handled

| Case | Behavior |
|---|---|
| User posts "checkin" multiple times in one day | First one wins; subsequent ignored (or DM: "you're already checked in") |
| User checks out without checking in | DM: "Use /attendance to set both times" |
| User edits an entry to add times later | Trigger recomputes total_hours |
| Vercel cron runs at midnight, user forgot to checkout | NEW cron: 8 PM PKT — DM users who checked in but not out: "Did you forget to check out? Edit the entry or reply with the time." |
| Employee on leave (full / sick) | total_hours = NULL by trigger, regardless of any times stored |
| Times look impossible (checkin 9pm, checkout 9am) | Trigger sets total_hours to NULL; HR sees this and can edit |
| Mid-shift WFH (came to office, left for WFH) | Single shift assumption — they pick one type for the day. If they want both, they edit and use the reason field |

---

## What we are NOT building

- ❌ Lunch break tracking
- ❌ Multiple sessions per day
- ❌ Late-arrival flags or thresholds
- ❌ Auto check-in via geolocation
- ❌ Required minimum hours per role/team
- ❌ Hours comparison rankings ("who works most")
- ❌ Email digests of low hours to HR

If you want any of these later, come back to design first.

---

## Build Order

Two PRs, in order. Don't combine them.

### PR 1 — Navigation + Self-Edit (small, ships first)
1. Extend `TopBar` with role-aware menu, mobile hamburger
2. Add Edit button + form to Day Detail modal
3. Add Delete button (HR/admin only)
4. Add backdated-entry flow on past empty cells
5. Lock approved-leave entries
6. Wire audit_log writes
7. Test on existing data — no schema migration needed for PR 1

**Testable on its own.** Ship, verify, then PR 2.

### PR 2 — Hours Tracking (bigger)
1. Schema migration: `supabase/hours_tracking.sql` (trigger included)
2. Slack parser additions (time parsing + checkin/checkout patterns)
3. Today banner enhancement on `/`
4. Calendar cell hour display
5. Day Detail modal time pickers
6. `/history` new columns + CSV export update
7. NEW `/admin/hours` page
8. `/admin/report` add hours columns + Excel update
9. Sunday digest hours line
10. NEW cron `/api/cron/checkout-reminder` at 8 PM PKT weekdays

---

## Testing checklist

### PR 1
- [ ] TopBar shows correct items for employee role
- [ ] TopBar shows admin items for hr role
- [ ] Mobile hamburger opens and closes
- [ ] Can edit my own attendance from calendar
- [ ] Cannot edit a full-leave entry (button hidden)
- [ ] HR can edit anyone's entries from their calendar
- [ ] Can add a backdated entry for a past empty weekday
- [ ] audit_log gets a row for every edit/add

### PR 2
- [ ] SQL trigger correctly computes hours for present/wfh
- [ ] Trigger returns NULL for leave/sick
- [ ] Trigger returns 4.0 for half day regardless of times
- [ ] Bot parses "checkin 9:30am" correctly
- [ ] Bot parses "checkout 6pm" correctly  
- [ ] Two messages in same day (checkin morning, checkout evening) update same row
- [ ] Dashboard banner shows correct state at each phase (none → in → out)
- [ ] Calendar cells show hour numbers
- [ ] `/admin/hours` page loads and shows correct totals
- [ ] Monthly report includes hours columns
- [ ] Excel export includes hours
- [ ] Sunday digest mentions weekly hours
- [ ] 8 PM checkout reminder fires for un-checked-out employees

---

*End of Phase 7 spec.*
