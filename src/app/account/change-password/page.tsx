import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function ForcedChangePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // If the flag isn't set, don't trap the user here — send them home.
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("employees")
    .select("must_change_password, full_name")
    .eq("id", user.id)
    .maybeSingle<{ must_change_password: boolean; full_name: string }>();
  if (!row?.must_change_password) redirect("/me");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-5 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome, {row.full_name.split(/\s+/)[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            Set a personal password before you continue. You can&apos;t use
            the rest of the app until this is done.
          </p>
        </div>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
