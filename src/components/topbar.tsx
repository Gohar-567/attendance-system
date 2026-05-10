import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { monthLabel, todayISO } from "@/lib/date";

interface TopBarProps {
  fullName: string;
  teamName?: string | null;
  monthISO?: string;
  showHistoryLink?: boolean;
  showApprovalsLink?: boolean;
  /** "hr" → "/admin", "lead" → "/admin/team", undefined → no link */
  adminLink?: "hr" | "lead";
}

export function TopBar({
  fullName,
  teamName,
  monthISO,
  showHistoryLink = true,
  showApprovalsLink = false,
  adminLink,
}: TopBarProps) {
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  const displayMonth = monthLabel(monthISO ?? todayISO());

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials || "?"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              {fullName}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {teamName ?? "No team yet"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
            {displayMonth}
          </span>
          {adminLink && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={adminLink === "hr" ? "/admin" : "/admin/team"}>
                Admin
              </Link>
            </Button>
          )}
          {showApprovalsLink && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/approvals">Approvals</Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/leave">Leaves</Link>
          </Button>
          {showHistoryLink && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/history">History</Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/me">Profile</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
