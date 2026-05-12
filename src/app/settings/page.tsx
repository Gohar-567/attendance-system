import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { NotificationToggles } from "@/components/settings/notification-toggles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: employee } = await supabase
    .from("employees")
    .select(
      `id, full_name, digest_enabled, nudge_enabled,
       team:teams!team_id ( id, name )`,
    )
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      full_name: string;
      digest_enabled: boolean;
      nudge_enabled: boolean;
      team: { id: string; name: string } | null;
    }>();

  if (!employee) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <Card>
            <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
              Your account isn&apos;t linked to an employee record yet. Ask
              HR to add you.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Choose which Slack DMs you want from the bot.
          </p>
        </div>

        <NotificationToggles
          digestEnabled={employee.digest_enabled}
          nudgeEnabled={employee.nudge_enabled}
        />
      </main>
    </div>
  );
}
