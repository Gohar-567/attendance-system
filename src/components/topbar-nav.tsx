"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Menu, Settings as SettingsIcon, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";
import type { EmployeeRole } from "@/lib/nav";

interface NavItem {
  href: string;
  label: string;
  /** Match this prefix for active state (e.g. /leave matches /leave/new too). */
  match?: string;
}

interface MenuGroup {
  key: "me" | "team" | "admin";
  label: string;
  items: NavItem[];
}

export interface TopBarNavProps {
  fullName: string;
  teamName: string | null;
  role: EmployeeRole;
  isHr: boolean;
  isLead: boolean;
}

/**
 * Build the role-aware menu per PHASE_7_DESIGN.md §7A. Items inside a group
 * collapse into a single desktop dropdown; mobile renders them as labelled
 * sections in the slide-out drawer.
 *
 * "Hours overview" is intentionally omitted — that page lives in PR 2.
 */
function buildMenu({
  isHr,
  isLead,
}: {
  isHr: boolean;
  isLead: boolean;
}): MenuGroup[] {
  const groups: MenuGroup[] = [
    {
      key: "me",
      label: "Me",
      items: [
        { href: "/", label: "My calendar" },
        { href: "/history", label: "My history" },
        { href: "/leave", label: "My leaves", match: "/leave" },
        { href: "/leave/new", label: "Request leave" },
        { href: "/me", label: "My profile" },
      ],
    },
  ];

  if (isLead || isHr) {
    const teamItems: NavItem[] = [
      { href: "/approvals", label: "Approvals" },
    ];
    // Team view is leads-only per the spec — HR uses /admin instead.
    if (isLead && !isHr) {
      teamItems.push({ href: "/admin/team", label: "Team view" });
    }
    groups.push({ key: "team", label: "Team", items: teamItems });
  }

  if (isHr) {
    groups.push({
      key: "admin",
      label: "Admin",
      items: [
        { href: "/admin", label: "Admin dashboard" },
        { href: "/admin/report", label: "Reports" },
        { href: "/admin/hours", label: "Hours overview" },
        {
          href: "/admin/employees",
          label: "Manage employees",
          match: "/admin/employees",
        },
        { href: "/admin/teams", label: "Manage teams" },
        { href: "/admin/parser-log", label: "Parser log" },
      ],
    });
  }

  return groups;
}

function isItemActive(pathname: string, item: NavItem | { href: string; match?: string }): boolean {
  if (item.href === "/") return pathname === "/";
  const base = item.match ?? item.href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

function isGroupActive(pathname: string, group: MenuGroup): boolean {
  return group.items.some((it) => isItemActive(pathname, it));
}

export function TopBarNav({
  fullName,
  teamName,
  isHr,
  isLead,
}: TopBarNavProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const groups = buildMenu({ isHr, isLead });

  // Close the drawer on route change.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [drawerOpen]);

  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const settingsActive = isItemActive(pathname, { href: "/settings" });

  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="hidden min-w-0 md:block">
            <div className="truncate text-sm font-semibold leading-tight">
              {fullName}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {teamName ?? "No team yet"}
            </div>
          </div>
        </Link>

        {/* Desktop: grouped dropdowns. */}
        <nav
          aria-label="Primary"
          className="hidden flex-1 items-center justify-end gap-1 sm:flex"
        >
          {groups.map((group) => {
            const active = isGroupActive(pathname, group);
            return (
              <DropdownMenu key={group.key}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "gap-1",
                      active && "font-semibold",
                    )}
                  >
                    {group.label}
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[12rem]">
                  <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {group.items.map((it) => {
                    const itemActive = isItemActive(pathname, it);
                    return (
                      <DropdownMenuItem key={it.href} asChild>
                        <Link
                          href={it.href}
                          aria-current={itemActive ? "page" : undefined}
                          className={cn(
                            "w-full",
                            itemActive && "font-semibold text-foreground",
                          )}
                        >
                          {it.label}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}

          <span aria-hidden className="mx-1 h-5 w-px bg-border" />

          <Button
            variant={settingsActive ? "secondary" : "ghost"}
            size="icon"
            asChild
            title="Notification settings"
          >
            <Link href="/settings" aria-label="Settings">
              <SettingsIcon className="h-4 w-4" />
            </Link>
          </Button>
          <SignOutButton />
        </nav>

        {/* Mobile: hamburger toggle. */}
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 sm:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col bg-background shadow-xl sm:hidden"
          >
            <div className="flex h-14 items-center justify-between border-b px-4">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs">
                    {initials || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {fullName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {teamName ?? "No team yet"}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {groups.map((group, i) => (
                <div
                  key={group.key}
                  className={cn(i > 0 && "mt-4 border-t pt-4")}
                >
                  <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </div>
                  <ul className="space-y-0.5">
                    {group.items.map((it) => {
                      const active = isItemActive(pathname, it);
                      return (
                        <li key={it.href}>
                          <Link
                            href={it.href}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex min-h-[44px] items-center rounded-md px-3 text-sm transition-colors",
                              active
                                ? "bg-secondary font-semibold text-foreground"
                                : "text-foreground/80 hover:bg-muted",
                            )}
                          >
                            {it.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <div className="border-t p-3 space-y-1">
              <Link
                href="/settings"
                className={cn(
                  "flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm transition-colors",
                  settingsActive
                    ? "bg-secondary font-semibold"
                    : "text-foreground/80 hover:bg-muted",
                )}
              >
                <SettingsIcon className="h-4 w-4" />
                Settings
              </Link>
              <SignOutButton className="w-full justify-start min-h-[44px]" />
            </div>
          </aside>
        </>
      )}
    </header>
  );
}
