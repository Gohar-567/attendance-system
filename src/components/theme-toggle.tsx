"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  /** "icon" — compact icon-only button (desktop header).
   *  "row" — full-width labelled row, matching the mobile drawer's other
   *  links (Settings, Sign out). */
  variant?: "icon" | "row";
}

export function ThemeToggle({ className, variant = "icon" }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  // Avoid rendering theme-dependent UI before the client mounts — the
  // server can't know the user's system/stored preference.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  const toggle = () => setTheme(isDark ? "light" : "dark");

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-sm text-foreground/80 transition-colors hover:bg-muted",
          className,
        )}
      >
        {isDark ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
        {isDark ? "Light mode" : "Dark mode"}
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      title="Toggle theme"
      aria-label="Toggle theme"
      onClick={toggle}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
