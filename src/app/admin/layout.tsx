import { redirect } from "next/navigation";

import { AdminBottomNav } from "@/components/admin/bottom-nav";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Centralised role check for /admin/*. Pages may also call requireAdmin*
  // for kind-specific gates, but we double-check here so the layout never
  // wraps a page for an unauthorized user.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: actor } = await admin
    .from("employees")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; role: string }>();
  if (!actor) redirect("/");

  const isHr = actor.role === "hr" || actor.role === "admin";

  // Leads see the bottom nav too, but with one tab.
  const { count: leadCount } = await admin
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", actor.id);
  const isLead = (leadCount ?? 0) > 0;

  if (!isHr && !isLead) redirect("/");

  return (
    <>
      <div className="pb-20 sm:pb-0">{children}</div>
      <AdminBottomNav variant={isHr ? "hr" : "lead"} />
    </>
  );
}
