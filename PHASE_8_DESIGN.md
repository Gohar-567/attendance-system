# Phase 8 Update — Password Login + 24/7 Shift Support

> Extension to BUILD_MANIFEST.md and PHASE_7_DESIGN.md. Addresses two critical issues found during testing before team rollout.
> Read before building. When something is ambiguous, this doc wins for Phase 8 only.

---

## Why this exists

Two issues blocked the team rollout:

1. **Login** — Slack OAuth alone doesn't work for everyone. Some staff don't have Slack workspace access, some only use mobile, some hit popup blockers in Slack desktop.
2. **24/7 shifts** — current schema assumes one shift = one calendar date. But shifts spanning midnight (e.g. 6 PM Mon → 2 AM Tue) break the hours computation entirely. Returns NULL or negative values.

Both are blockers. Both ship together as Phase 8.

---

## Decisions Locked

Not re-debatable mid-build:

1. **Dual login** — Slack OAuth AND email/password coexist. Each employee picks. HR can issue/reset passwords.
2. **Self-service signup is OFF.** Only HR creates accounts.
3. **Shifts use TIMESTAMPTZ**, not TIME. The schema represents the *actual moment* of check-in and check-out, not a "time of day."
4. **Max shift = 16 hours** for sanity-check guard. Anything longer → hours set to NULL (visible in UI as "—", HR investigates).
5. **A shift "belongs" to its start date.** A shift starting Mon 11 PM and ending Tue 7 AM is logged on Monday's calendar row. The Tuesday row is unrelated.
6. **Reminders are fixed times, not personalized:** 11 AM PKT for checkin nudge, 9 PM PKT for checkout reminder. Works regardless of role/shift since both are reasonable "you should have checked in/out by now" thresholds.
7. **Per-employee shift profile is optional metadata** (for HR/lead visibility), not enforcement.
8. **Existing data preserved.** Migration converts existing `checkin_time TIME` + `date` into `checkin_at TIMESTAMPTZ` by combining them; same for checkout.

---

## Section 8A — Password Login

### What changes

Login page becomes dual UI:
- Big "Sign in with Slack" button (current flow, unchanged)
- "or" divider
- Email + password form below

Both end up at the same auth state. Backend doesn't care which was used.

### Supabase Auth setup

Supabase Auth already supports email/password — we just enable it.

1. **Supabase Dashboard → Authentication → Providers → Email** → toggle ON
2. **Confirm email** option → toggle OFF (we don't want signup confirmation emails since signup is admin-only)
3. **Email templates** → password reset template can stay default

### Adding employees with password

`/admin/employees` Add Employee modal grows:
- Existing fields (name, email, team, role, etc.)
- New: **Login method** radio:
  - "Slack only" (current default)
  - "Password" → reveals a temporary password input (HR types one, e.g. `Welcome2026!`) + "Force change on first login" checkbox (default ON)
- On save:
  - If "Slack only" → existing flow, no password
  - If "Password" → call Supabase Admin API to create the auth user with that password, store `must_change_password = true` on employees row

### New columns on `employees`

```sql
ALTER TABLE employees
  ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'slack',  -- 'slack' | 'password' | 'both'
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
```

`auth_method = 'both'` is for an employee who has both — they can use whichever.

### First-login flow for password users

After login, if `must_change_password = true`:
- Redirect to `/account/change-password` (forced, can't navigate away)
- Form: new password + confirm
- On save: update password via Supabase, set `must_change_password = false`, redirect to `/me`

### HR password reset

In `/admin/employees/[id]`:
- Add **"Reset password"** button (HR/admin only)
- Click → modal: "Set a new temporary password for [name]"
- Input + "Force change on first login" checkbox
- Submit: calls Supabase Admin API to update the user's password, sets `must_change_password = true`
- Audit log entry: action=`password_reset_by_hr`, target_id=employee_id

### Self-service password change

`/settings` gets a new section:
- "Change password" (only visible if `auth_method` includes 'password')
- Inputs: current password, new password, confirm
- Submit: re-auth with current password, then update

### Forgot password

`/login` gets a small link: "Forgot password?"
- Opens `/forgot-password` page
- Email input, submit
- Calls `supabase.auth.resetPasswordForEmail()` which sends a reset email
- Email links to `/reset-password?token=...`
- Page validates token, lets user set new password

This is all built-in Supabase Auth — minimal custom code, just plumbing the UI.

### Security guardrails

- Min password length: 8 chars
- Block obvious passwords: HR can't set `password123` etc. (use a simple denylist)
- Failed login attempts: Supabase Auth has built-in rate limiting, no custom code needed
- Sessions: existing JWT flow works for both auth methods

---

## Section 8B — 24/7 Shifts (TIMESTAMPTZ)

### Schema migration

Run as `supabase/shifts_timestamptz.sql`:

```sql
-- Step 1: add new TIMESTAMPTZ columns
ALTER TABLE attendance_logs
  ADD COLUMN checkin_at TIMESTAMPTZ,
  ADD COLUMN checkout_at TIMESTAMPTZ;

-- Step 2: backfill from existing TIME + date columns (Asia/Karachi timezone)
UPDATE attendance_logs
SET checkin_at = (date::text || ' ' || checkin_time::text)::timestamp AT TIME ZONE 'Asia/Karachi'
WHERE checkin_time IS NOT NULL;

UPDATE attendance_logs
SET checkout_at = (date::text || ' ' || checkout_time::text)::timestamp AT TIME ZONE 'Asia/Karachi'
WHERE checkout_time IS NOT NULL;

-- Step 3: replace the hours-compute trigger
DROP TRIGGER IF EXISTS attendance_compute_hours ON attendance_logs;
DROP FUNCTION IF EXISTS compute_total_hours();

CREATE OR REPLACE FUNCTION compute_total_hours()
RETURNS TRIGGER AS $$
DECLARE
  delta_hours NUMERIC;
BEGIN
  -- Leave / sick / holiday → NULL
  IF NEW.type IN ('full_leave', 'sick', 'holiday') THEN
    NEW.total_hours := NULL;
    NEW.checkin_at := NULL;
    NEW.checkout_at := NULL;

  -- Half leave → fixed 4.0
  ELSIF NEW.type = 'half_leave' THEN
    NEW.total_hours := 4.0;

  -- Present / WFH / EWD → compute from timestamps if both set
  ELSIF NEW.checkin_at IS NOT NULL AND NEW.checkout_at IS NOT NULL THEN
    delta_hours := EXTRACT(EPOCH FROM (NEW.checkout_at - NEW.checkin_at)) / 3600.0;
    -- Reject impossible shifts: negative, zero, or > 16 hours
    IF delta_hours <= 0 OR delta_hours > 16 THEN
      NEW.total_hours := NULL;
    ELSE
      NEW.total_hours := ROUND(delta_hours, 2);
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

-- Step 4: drop the old TIME columns (after verifying backfill succeeded)
-- Run this only after confirming all data is migrated. Comment out and run manually.
-- ALTER TABLE attendance_logs DROP COLUMN checkin_time;
-- ALTER TABLE attendance_logs DROP COLUMN checkout_time;

-- Step 5: helpful index
CREATE INDEX IF NOT EXISTS idx_attendance_checkin_at
  ON attendance_logs(employee_id, checkin_at)
  WHERE checkin_at IS NOT NULL;
```

**Important:** Step 4 (dropping old columns) is commented out. Run the migration, verify data looks right via SELECT, *then* manually drop the old columns. Two-step migration = safety net.

### Slack parser changes

The parser stays in `lib/slack/parser.ts`. Patterns are unchanged but **behavior** changes:

**On checkin message:**
1. Parse time (e.g. "checkin 6:30pm" → 18:30)
2. Combine with today's date in Asia/Karachi → TIMESTAMPTZ
3. **Look for an open shift** (most recent row for this employee where `checkin_at IS NOT NULL AND checkout_at IS NULL` within last 16 hours)
4. If found → DM user: "You already have an open shift from [checkin_at]. Did you mean to check out?" — don't create a new row
5. If not found → INSERT a new row with the date = the date that `checkin_at` falls on in Asia/Karachi

**On checkout message:**
1. Parse time (e.g. "checkout 2am" → 02:00)
2. **Find the open shift** for this employee (most recent row with `checkin_at IS NOT NULL AND checkout_at IS NULL`)
3. If found → set `checkout_at` for that shift. Compute the checkout's actual TIMESTAMPTZ:
   - If parsed time > checkin_at's time-of-day → checkout is same calendar day as checkin
   - If parsed time < checkin_at's time-of-day → checkout is NEXT calendar day (crossed midnight)
   - Trigger validates: delta must be 0–16 hours, else NULL
4. If no open shift → DM: "You haven't checked in yet. Use /attendance to log this shift."

**Key insight:** The "open shift" lookup makes the parser cross-midnight aware without complex logic. Each shift is one row; the row's `date` column = the start date.

### UI changes

#### Today banner (dashboard `/`)
Same three-state design, but reads from `checkin_at`/`checkout_at`:
- Not checked in → "Check in now" button
- Checked in → "Checked in at [time]" (shows time in Asia/Karachi)
- Both done → "Checked in [date if not today] [time] · Checked out [date if not today] [time] · 8.5 hours"

The "[date if not today]" part matters — if Ali checked in Mon 11 PM, today is Tuesday, banner says: "Checked in yesterday 11:00 PM · ..."

#### Calendar cells
- Cell shows on the **shift's start date** (the `date` column).
- A shift starting Mon 11 PM and ending Tue 7 AM appears as one Monday cell with `8` hours.
- Tuesday's cell is empty (or its own shift, if there was one starting Tuesday).

#### Day Detail modal
- View mode: shows full datetime for checkin/checkout (e.g. "Mon May 12, 11:00 PM" and "Tue May 13, 7:00 AM")
- Edit mode: **datetime pickers** (date + time), not just time pickers
- Live total computed client-side as user changes timestamps
- Validation: checkout must be after checkin, max 16h apart

#### Hours-this-week card
- Group shifts by their `date` (shift start date) within current week
- Sum total_hours
- A shift starting Sunday 11 PM but ending Monday 7 AM belongs to last week (since it started Sunday)

### Cron changes

#### 11 AM checkin nudge
- Endpoint: `/api/cron/checkin-reminder`
- Schedule: 11:00 AM PKT daily Mon–Sun (= 6:00 UTC). Schedule: `0 6 * * *`
- Logic: for each active employee with `nudge_enabled = true`:
  - Skip if today is a holiday
  - Skip if they have ANY attendance_logs row with `date = today OR date = yesterday AND checkout_at IS NULL` (means they're mid-shift from yesterday — they're working, don't nag)
  - DM: "Morning! Haven't seen you check in yet today. Quick log?" with 4 buttons (At office / WFH / Half day / Sick)

#### 9 PM checkout reminder
- Endpoint: `/api/cron/checkout-reminder` (existing, change schedule + logic)
- Schedule: 9:00 PM PKT daily (= 16:00 UTC). Schedule: `0 16 * * *`
- Logic: for each employee with an open shift (`checkin_at IS NOT NULL AND checkout_at IS NULL`):
  - Skip if the open shift started less than 4 hours ago (they probably just started)
  - DM: "You checked in at [time]. Don't forget to check out when you're done. Reply 'checkout' or edit your entry."

### Per-employee shift profile (optional metadata)

New columns on `employees`:
```sql
ALTER TABLE employees
  ADD COLUMN typical_shift_start TIME,
  ADD COLUMN typical_shift_end TIME,
  ADD COLUMN shift_crosses_midnight BOOLEAN DEFAULT false;
```

Used for:
- Display in `/admin/employees/[id]`: "Ali's typical shift: 6 PM – 2 AM"
- HR can set when adding/editing an employee
- **NOT** used for enforcement, alerts, or nudge logic. Pure metadata.

UI: Add Employee modal + Edit modal get three new fields under an "Optional: typical shift" section.

### Weekly digest changes

Sunday digest groups shifts by their `date` (start date). A shift starting Sunday 11 PM is in this week's digest. Hours sentence unchanged, just driven by the new schema.

### Other cleanup
- `/admin/hours` page: queries already use `total_hours`, no change needed there
- Monthly report: same
- Excel exports: replace `Check-in` / `Check-out` columns showing TIME with full datetime strings (e.g. "May 12, 11:00 PM")

---

## Edge cases handled

| Case | Behavior |
|---|---|
| Forgot to checkout from last night's shift | This morning's checkin DMs: "You have an open shift from [yesterday's date]. Check out first?" |
| Posted "checkin" at 11 PM, "checkout" at 7 AM next day | One row, date = yesterday, hours = 8.0 ✅ |
| Posted "checkout" with no open shift | Bot DMs to use `/attendance` |
| Two checkins same day with no checkout in between | Bot rejects second, keeps first ✅ |
| Cross-midnight + half day same day | Impossible by definition (half day = no checkin/out). UI prevents this. |
| Edit reduces checkout_at to before checkin_at | Trigger returns NULL hours; UI shows validation error before save |
| Employee on overnight shift takes leave for next day | The leave row is for next day's `date`. The night-shift row's date is today. They don't conflict ✅ |
| 17-hour shift (someone forgot to checkout for a day) | Trigger sets hours to NULL. HR sees "—" in reports → investigates and fixes via edit. |
| Holidays | `/api/cron/checkin-reminder` checks holidays table |

---

## What we are NOT building

- ❌ Auto-checkout (the "I forgot" should be visible, not silently fixed)
- ❌ Shift scheduling (this is attendance, not scheduling — different product)
- ❌ Overtime calculations (no expected hours per role/employee)
- ❌ Multiple shifts per day (one row = one shift, period)
- ❌ Different shift definitions per day of week
- ❌ Auto-detect shift pattern from history

---

## Build Order

Two PRs. Ship password login first since it's smaller and lower-risk.

### PR 1 — Password auth (8A)
1. Enable Email auth in Supabase
2. Add `auth_method` + `must_change_password` columns
3. Login page dual UI
4. `/admin/employees` add password option
5. `/admin/employees/[id]` reset button + modal
6. `/account/change-password` forced flow
7. `/settings` self-service password section
8. `/forgot-password` + `/reset-password` flows
9. Audit log on all password events

**Testable on its own.** Ship + verify.

### PR 2 — 24/7 shifts (8B)
1. Run `supabase/shifts_timestamptz.sql` (Steps 1–3 only; defer Step 4)
2. Update Slack parser to use TIMESTAMPTZ + open-shift logic
3. Update `lib/time.ts` helpers
4. Update server actions (checkin/checkout/edit/backdate)
5. Update Today banner display
6. Update calendar cell display + click handlers
7. Update Day Detail modal to datetime pickers
8. Update Hours-this-week card grouping
9. Update weekly digest grouping
10. New checkin reminder cron (11 AM)
11. Update existing checkout reminder cron (9 PM)
12. Per-employee shift profile fields
13. Excel export updates
14. After verifying everything works for a week → drop old `checkin_time` / `checkout_time` columns (Step 4 of migration)

---

## Testing Checklist

### PR 1 (Password Auth)
- [ ] Sign in with Slack still works
- [ ] Sign in with email + password works (after HR sets one)
- [ ] First login with temp password redirects to `/account/change-password`
- [ ] After changing password, redirect to `/me`
- [ ] HR can reset password from `/admin/employees/[id]`
- [ ] Reset password forces change on next login
- [ ] `/settings` lets user change own password (requires current password)
- [ ] Forgot password flow sends email and lets reset
- [ ] Audit log records all password events

### PR 2 (24/7 Shifts)
- [ ] Migration runs without data loss (compare row counts before/after)
- [ ] Existing TIME values correctly converted to TIMESTAMPTZ
- [ ] `total_hours` recomputes correctly post-migration
- [ ] Post "checkin 11pm" → row created, date = today
- [ ] Post "checkout 7am" next morning → same row updated, hours = 8.0
- [ ] Post "checkin 9am" while open shift exists → bot warns
- [ ] Post "checkout 6pm" with no open shift → bot DMs to use slash command
- [ ] 16+ hour shift → hours = NULL, visible as "—"
- [ ] Calendar shows night shift on its start date
- [ ] Today banner shows "yesterday" prefix when checkin was yesterday
- [ ] Hours-this-week correctly groups shifts by start date
- [ ] 11 AM checkin reminder fires (test manually)
- [ ] 9 PM checkout reminder fires for open shifts older than 4h
- [ ] Excel export shows full datetime strings
- [ ] HR can set typical_shift_start/end in employee edit
- [ ] Per-employee shift display in `/admin/employees/[id]`

---

*End of Phase 8 spec.*
