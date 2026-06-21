import { TodayBanner } from "@/components/dashboard/today-banner";
import { BalanceCards } from "@/components/dashboard/balance-cards";
import { HoursThisWeekCard } from "@/components/dashboard/hours-this-week";
import { MonthCalendar } from "@/components/dashboard/month-calendar";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { firstOfMonthISO, isWeekend } from "@/lib/date";
import type { DashboardData } from "@/lib/dashboard";

interface DashboardSectionsProps {
  data: DashboardData;
  /** The signed-in user's id (used by the calendar's edit-permission check). */
  viewerId: string;
  /** Signed-in viewer is HR/admin? */
  viewerIsHr: boolean;
  /** Hide the "Log WFH / Half day / Request leave" row when HR is looking at
   *  someone else's calendar. */
  showQuickActions?: boolean;
  /** When viewing someone else, scope newly-added (backdated) entries to that
   *  employee. The calendar passes this down to addBackdatedAttendanceAction. */
  targetEmployeeId?: string;
}

/**
 * Server component that renders the calendar dashboard for one employee.
 * Used both by `/` (signed-in user) and `/admin/employees/[id]` (HR view).
 *
 * When the calendar is paged to a past month (data.monthStartISO !== this
 * month), the "Hours this week" card is hidden — its data is in the
 * current-month logs, not the loaded past-month logs.
 */
export function DashboardSections({
  data,
  viewerId,
  viewerIsHr,
  showQuickActions = true,
  targetEmployeeId,
}: DashboardSectionsProps) {
  const {
    employee,
    todayISO,
    monthStartISO,
    monthLogs,
    monthSessions,
    holidays,
    balance,
    wfhThisMonth,
    todayLog,
    todayHoliday,
    isFirstTime,
  } = data;

  // Only the row's owner gets the one-click check-in/out buttons.
  // HR viewing someone else uses the edit form instead.
  const isOwner = viewerId === employee.id;
  const viewingCurrentMonth = monthStartISO === firstOfMonthISO(todayISO);

  if (isFirstTime) {
    return (
      <>
        <BalanceCards balance={balance} wfhThisMonth={0} />
        <EmptyState
          fullName={employee.full_name}
          slackLinked={!!employee.slack_user_id}
          hasTeam={!!employee.team_id}
        />
      </>
    );
  }

  return (
    <>
      <TodayBanner
        todayISO={todayISO}
        log={todayLog}
        sessions={monthSessions.filter((s) => s.session_date === todayISO)}
        isWeekend={isWeekend(todayISO)}
        holidayName={todayHoliday}
        showCheckinControls={isOwner}
      />

      <BalanceCards balance={balance} wfhThisMonth={wfhThisMonth} />

      {viewingCurrentMonth && (
        <HoursThisWeekCard sessions={monthSessions} todayISO={todayISO} />
      )}

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <MonthCalendar
            monthISO={monthStartISO}
            todayISO={todayISO}
            logs={monthLogs}
            sessions={monthSessions}
            holidays={holidays.map((h) => ({ date: h.date, name: h.name }))}
            currentUserId={viewerId}
            isHr={viewerIsHr}
            targetEmployeeId={targetEmployeeId}
          />
        </CardContent>
      </Card>

      {showQuickActions && <QuickActions todayMarked={!!todayLog} />}
    </>
  );
}
