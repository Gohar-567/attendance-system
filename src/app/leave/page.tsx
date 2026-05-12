import Link from "next/link";
import { redirect } from "next/navigation";

import { TopBar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MyLeaveRow } from "@/components/leave/my-leave-row";
import { createClient } from "@/lib/supabase/server";
import { LEAVE_TYPE_LABEL, type LeaveRequest } from "@/lib/leave/types";

export const dynamic = "force-dynamic";

export default async function MyLeavesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("leave_requests")
    .select(
      "id, employee_id, type, from_date, to_date, reason, status, approver_id, decided_at, decision_note, created_at",
    )
    .eq("employee_id", user.id)
    .order("created_at", { ascending: false });

  const requests = (rows ?? []) as LeaveRequest[];

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              My leave requests
            </h1>
            <p className="text-sm text-muted-foreground">
              Pending, approved, rejected, and cancelled requests.
            </p>
          </div>
          <Button asChild>
            <Link href="/leave/new">New request</Link>
          </Button>
        </div>

        {requests.length === 0 ? (
          <Card>
            <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
              No leave requests yet.{" "}
              <Link href="/leave/new" className="font-medium underline">
                Submit one.
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Dates</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <MyLeaveRow key={r.id} request={r} />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Legend />
      </main>
    </div>
  );
}

function Legend() {
  const items: { label: string; variant: "default" | "secondary" | "destructive" | "outline" }[] = [
    { label: "Pending", variant: "secondary" },
    { label: "Approved", variant: "default" },
    { label: "Rejected", variant: "destructive" },
    { label: "Cancelled", variant: "outline" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>Status types:</span>
      {items.map((it) => (
        <Badge key={it.label} variant={it.variant}>
          {it.label}
        </Badge>
      ))}
      <span className="ml-auto">
        Type labels:{" "}
        {Object.values(LEAVE_TYPE_LABEL).join(" · ")}
      </span>
    </div>
  );
}
