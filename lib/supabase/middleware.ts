import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseAuthConfigured, supabaseAnonKey, supabaseUrl } from "./config";

const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/forgot-password",
  "/reset-password",
  // Vercel Cron hits this with a CRON_SECRET bearer token, not a browser
  // session cookie — the route itself checks that secret (fails closed with
  // 503/401), so it must not be redirected to /login first.
  "/api/cron",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

/**
 * Refreshes the Supabase auth session on every request and gates the app:
 * unauthenticated users are sent to /login; authenticated users hitting
 * /login are sent home.
 *
 * Auth is mandatory in production: with billing attached, an unconfigured auth
 * layer would mean free, unattributed AI spend. Only in development do we pass
 * through unconfigured (so the per-page "Connect Supabase" guides still render
 * for local first-run setup).
 */
export async function updateSession(request: NextRequest) {
  if (!isSupabaseAuthConfigured()) {
    if (process.env.NODE_ENV === "development") {
      return NextResponse.next({ request });
    }
    // Production with no auth configured: fail closed instead of serving the
    // app (and its AI routes) to anyone.
    return NextResponse.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
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
  });

  // Do not run between supabase calls and getUser — the docs warn it breaks
  // session refresh. Just read the user.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return supabaseResponse;
}
