import Link from "next/link";
import { notFound } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { DashboardSections } from "@/components/dashboard/dashboard-sections";
import { ResetPasswordButton } from "@/components/admin/reset-password-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAdminEmployee } from "@/lib/admin/guard";
import { loadDashboardData } from "@/lib/dashboard";
import { resolveMonthParam } from "@/lib/dashboard-params";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}

export default async function EmployeeCalendarPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { actor } = await requireAdminEmployee({ kind: "hr_or_admin" });

  const sp = await searchParams;
  const monthISO = resolveMonthParam(sp.month);

  const data = await loadDashboardData(id, { monthISO });
  if (!data) notFound();

  const isSelf = data.employee.id === actor.id;

  // Read the employee's current auth_method so the "Reset password" button
  // copy can adapt ("set a password" vs "reset password"). loadDashboardData
  // doesn't return it — read separately.
  const admin = createAdminClient();
  const { data: authRow } = await admin
    .from("employees")
    .select("auth_method")
    .eq("id", data.employee.id)
    .maybeSingle<{ auth_method: string }>();
  const authMethod = authRow?.auth_method ?? "slack";

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">
                  {data.employee.full_name}
                </h1>
                {isSelf && <Badge variant="outline">You</Badge>}
                <Badge variant="secondary" className="capitalize">
                  {data.employee.role.replace("_", " ")}
                </Badge>
                {data.employee.team?.name && (
                  <Badge variant="outline">{data.employee.team.name}</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Viewing as HR. Your edits write{" "}
                <span className="font-mono text-xs">
                  attendance_edited_by_hr
                </span>{" "}
                audit rows when changing someone else&apos;s entries.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" asChild>
                <Link href="/admin/employees">Back to roster</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/admin/employees?edit=${data.employee.id}`}>
                  Edit profile
                </Link>
              </Button>
              <ResetPasswordButton
                employeeId={data.employee.id}
                employeeName={data.employee.full_name}
                authMethod={authMethod}
              />
            </div>
          </CardContent>
        </Card>

        <DashboardSections
          data={data}
          viewerId={actor.id}
          viewerIsHr
          showQuickActions={false}
          targetEmployeeId={data.employee.id}
        />
      </main>
    </div>
  );
}
