import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSections } from "@/components/dashboard/dashboard-sections";
import { createClient } from "@/lib/supabase/server";
import { loadDashboardData } from "@/lib/dashboard";
import { resolveMonthParam } from "@/lib/dashboard-params";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const monthISO = resolveMonthParam(sp.month);

  const data = await loadDashboardData(user.id, { monthISO });
  if (!data) {
    return <UnlinkedShell email={user.email ?? "your account"} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
        <DashboardSections
          data={data}
          viewerId={user.id}
          viewerIsHr={
            data.employee.role === "hr" || data.employee.role === "admin"
          }
        />
      </main>
    </div>
  );
}

function UnlinkedShell({ email }: { email: string }) {
  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="space-y-2 p-6">
            <h2 className="text-lg font-semibold tracking-tight">
              Your account isn&apos;t linked yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Ask HR to add{" "}
              <span className="font-medium text-foreground">{email}</span> to
              the employees table. Once they do, refresh this page.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
