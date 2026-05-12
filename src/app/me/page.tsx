import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: employee, error } = await supabase
    .from("employees")
    .select(
      `
      id,
      full_name,
      email,
      role,
      slack_user_id,
      join_date,
      team:teams!team_id ( id, name )
    `,
    )
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      full_name: string;
      email: string;
      role: string;
      slack_user_id: string | null;
      join_date: string;
      team: { id: string; name: string } | null;
    }>();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <SignOutButton />
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Error loading profile: {error.message}
        </div>
      )}

      {!employee ? (
        <div className="rounded-lg border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Your account isn&apos;t linked to an employee record yet. Ask HR to
            add{" "}
            <span className="font-medium text-foreground">{user.email}</span>{" "}
            to the employees table.
          </p>
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-card p-6 sm:grid-cols-2">
          <Field label="Name" value={employee.full_name} />
          <Field label="Email" value={employee.email} />
          <Field label="Team" value={employee.team?.name ?? "—"} />
          <Field label="Role" value={employee.role} />
          <Field
            label="Slack user ID"
            value={employee.slack_user_id ?? "Not linked"}
          />
          <Field label="Joined" value={employee.join_date} />
        </dl>
      )}

      <div className="mt-8">
        <Button variant="outline" asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value ?? "—"}</dd>
    </div>
  );
}
