import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdminSupabaseClient } from "@supabase/supabase-js";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session so server components see fresh auth state.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicAuthRoute =
    pathname === "/login" ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth");
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/slack") ||
    pathname.startsWith("/api/cron") ||
    pathname === "/favicon.ico";
  // Forced-change page itself must be reachable while flagged, plus the
  // server actions endpoint (RSC POST) underneath. We allow everything
  // under /account so the page can render its form action target.
  const isForcedChangeRoute = pathname.startsWith("/account/change-password");

  if (!user && !isPublicAuthRoute && !isPublicAsset) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Phase 8A: bounce signed-in users into /account/change-password while
  // their must_change_password flag is set, regardless of where they
  // tried to go. Lightweight lookup via the service-role client (the
  // anon client is blocked by RLS from reading other employees but is
  // OK for the user's own row — still, service role is simpler).
  if (
    user &&
    !isForcedChangeRoute &&
    !isPublicAuthRoute &&
    !isPublicAsset
  ) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      const admin = createAdminSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const { data } = await admin
        .from("employees")
        .select("must_change_password")
        .eq("id", user.id)
        .maybeSingle<{ must_change_password: boolean }>();
      if (data?.must_change_password) {
        const url = request.nextUrl.clone();
        url.pathname = "/account/change-password";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
