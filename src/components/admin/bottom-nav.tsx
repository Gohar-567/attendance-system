"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck,
  ChartBar,
  Settings2,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface BottomNavProps {
  /**
   * Which tabs to show. HR sees all four; team-leads see only their own
   * dashboard tab (rendered by /admin/team).
   */
  variant: "hr" | "lead";
}

/**
 * Mobile-only bottom nav for /admin/*. Pinned with safe-area-inset so the
 * iOS home-indicator doesn't overlap. ≥44px tall hit targets.
 */
export function AdminBottomNav({ variant }: BottomNavProps) {
  const pathname = usePathname();
  const items =
    variant === "hr"
      ? [
          { href: "/admin", label: "Today", icon: CalendarCheck },
          { href: "/admin/report", label: "Reports", icon: ChartBar },
          { href: "/admin/employees", label: "Employees", icon: Users },
          { href: "/admin/teams", label: "Teams", icon: Settings2 },
        ]
      : [{ href: "/admin/team", label: "Today", icon: CalendarCheck }];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Admin navigation"
    >
      <ul className="grid grid-cols-4">
        {items.map((it) => {
          const active =
            pathname === it.href ||
            (it.href !== "/admin" && pathname.startsWith(it.href));
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <it.icon className="h-5 w-5" />
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
