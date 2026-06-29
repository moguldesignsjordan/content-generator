import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// Run on everything except static assets and the auth callback's own exchange
// is still allowed through by updateSession (public path). Next image / favicon
// etc. are skipped for speed.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|mogul-logo.webp|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|txt|map)$).*)",
  ],
};
