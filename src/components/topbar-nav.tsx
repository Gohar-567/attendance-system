"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Settings as SettingsIcon, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";
import type { EmployeeRole } from "@/lib/nav";

interface NavItem {
  href: string;
  label: string;
  /** Match this path AND any nested path under it for active state. */
  match?: string;
}

export interface TopBarNavProps {
  fullName: string;
  teamName: string | null;
  role: EmployeeRole;
  isHr: boolean;
  isLead: boolean;
}

/**
 * Build the menu per role per §7A of PHASE_7_DESIGN.md.
 * "Hours overview" intentionally absent — that page ships in PR 2.
 */
function buildMenu({ isHr, isLead }: { isHr: boolean; isLead: boolean }) {
  const sections: { heading?: string; items: NavItem[] }[] = [
    {
      heading: "Me",
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
    // Team view is leads-only per spec; HR has /admin instead.
    if (isLead && !isHr) {
      teamItems.push({ href: "/admin/team", label: "Team view" });
    }
    sections.push({ heading: "Team", items: teamItems });
  }

  if (isHr) {
    sections.push({
      heading: "Admin",
      items: [
        { href: "/admin", label: "Admin dashboard" },
        { href: "/admin/report", label: "Reports" },
        { href: "/admin/employees", label: "Manage employees" },
        { href: "/admin/teams", label: "Manage teams" },
        { href: "/admin/parser-log", label: "Parser log" },
      ],
    });
  }

  return sections;
}

function isActive(
  pathname: string,
  item: Pick<NavItem, "href"> & Partial<Pick<NavItem, "match">>,
): boolean {
  if (item.href === "/") return pathname === "/";
  const base = item.match ?? item.href;
  // Exact match, or nested route under this href.
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function TopBarNav({
  fullName,
  teamName,
  isHr,
  isLead,
}: TopBarNavProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sections = buildMenu({ isHr, isLead });
  const allItems = sections.flatMap((s) => s.items);

  // Close the drawer when the route changes (link clicked).
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

  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3">
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
        </Link>

        {/* Desktop: inline nav. Renders sections separated by a thin divider. */}
        <nav
          aria-label="Primary"
          className="hidden flex-1 items-center justify-end gap-1 sm:flex"
        >
          {allItems.map((it) => {
            // Use leading divider on the first item of each section after the first.
            const sectionIndex = sections.findIndex((s) =>
              s.items.includes(it),
            );
            const isFirstInSection =
              sectionIndex > 0 && sections[sectionIndex].items[0] === it;
            const active = isActive(pathname, it);
            return (
              <span key={it.href} className="flex items-center gap-1">
                {isFirstInSection && (
                  <span
                    aria-hidden
                    className="mx-1 h-5 w-px bg-border"
                  />
                )}
                <Button
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  asChild
                  className={cn(active && "font-semibold")}
                >
                  <Link href={it.href} aria-current={active ? "page" : undefined}>
                    {it.label}
                  </Link>
                </Button>
              </span>
            );
          })}

          <span aria-hidden className="mx-1 h-5 w-px bg-border" />

          <Button
            variant={isActive(pathname, { href: "/settings" }) ? "secondary" : "ghost"}
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
              <span className="text-sm font-semibold">Menu</span>
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
              {sections.map((section, si) => (
                <div key={si} className={cn(si > 0 && "mt-4 border-t pt-4")}>
                  {section.heading && (
                    <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {section.heading}
                    </div>
                  )}
                  <ul className="space-y-0.5">
                    {section.items.map((it) => {
                      const active = isActive(pathname, it);
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
                  isActive(pathname, { href: "/settings" })
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
