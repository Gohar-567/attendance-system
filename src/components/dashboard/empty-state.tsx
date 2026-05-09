import { CalendarDays, MessagesSquare, UserPlus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  fullName: string;
  slackLinked: boolean;
  hasTeam: boolean;
}

/**
 * First-login state for someone with no attendance entries yet.
 * Renders a welcome card + onboarding steps + a placeholder calendar block.
 */
export function EmptyState({ fullName, slackLinked, hasTeam }: EmptyStateProps) {
  const firstName = fullName.split(/\s+/)[0] || "there";

  const steps = [
    {
      icon: MessagesSquare,
      title: "Connect to Slack",
      body: slackLinked
        ? "Your Slack account is linked. Posts in #attendance will be auto-logged here."
        : "Once HR links your Slack ID, posts in #attendance will auto-log here.",
      done: slackLinked,
    },
    {
      icon: UserPlus,
      title: "Get assigned to a team",
      body: hasTeam
        ? "You're on a team — your team lead will see your attendance."
        : "HR will put you on a team so your lead can see your attendance.",
      done: hasTeam,
    },
    {
      icon: CalendarDays,
      title: "Mark your first day",
      body: "Use the buttons above the calendar, or just post in #attendance — the bot will pick it up.",
      done: false,
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 p-6">
          <h2 className="text-lg font-semibold tracking-tight">
            Welcome, {firstName}.
          </h2>
          <p className="text-sm text-muted-foreground">
            Here&apos;s how to get set up. You only need to do this once.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y p-0">
          {steps.map((s, i) => (
            <div
              key={i}
              className="flex items-start gap-4 p-4 sm:p-6"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  s.done
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <s.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-sm text-muted-foreground">{s.body}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-12 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No attendance yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your calendar fills in as entries come from Slack or the web.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
