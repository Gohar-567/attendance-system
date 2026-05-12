import { getNavContext } from "@/lib/nav";
import { TopBarNav } from "@/components/topbar-nav";

/**
 * Async server component. Pages just render `<TopBar />` — every other
 * concern (role, active route, mobile drawer, sign-out) lives inside.
 *
 * Returns null on signed-out (the middleware would normally redirect
 * before this renders; the null guard is defensive).
 */
export async function TopBar() {
  const ctx = await getNavContext();
  if (!ctx) return null;

  return (
    <TopBarNav
      fullName={ctx.fullName}
      teamName={ctx.teamName}
      role={ctx.role}
      isHr={ctx.isHr}
      isLead={ctx.isLead}
    />
  );
}
