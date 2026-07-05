import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

// Handles both email-link formats Supabase can send:
//  - ?token_hash=...&type=recovery|magiclink|... (email templates using
//    {{ .TokenHash }} — works from any browser, including dashboard-sent
//    recovery emails) → verifyOtp
//  - ?code=... (PKCE redirects) → exchangeCodeForSession
// On failure the user lands on /login with a visible error instead of a
// silent bounce.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") || "/";

  const supabase = await createClient();

  let errorMessage: string;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${url.origin}${next}`);
    errorMessage = error.message;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${url.origin}${next}`);
    errorMessage = error.message;
  } else {
    errorMessage = "That link is missing its sign-in code. Request a new one.";
  }

  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("error", errorMessage);
  return NextResponse.redirect(loginUrl);
}
