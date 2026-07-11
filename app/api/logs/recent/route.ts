import { NextRequest, NextResponse } from "next/server";
import { getUserRole, listLogsSince, listRecentLogs } from "@/lib/db/queries";
import { isSupabaseConfigured } from "@/lib/db/client";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import type { AppLogLevel } from "@/lib/db/types";
import { logError } from "@/lib/log";

const LEVELS: AppLogLevel[] = ["info", "warn", "error", "usage"];

function parseLevel(raw: string | null): AppLogLevel | undefined {
  return raw && LEVELS.includes(raw as AppLogLevel) ? (raw as AppLogLevel) : undefined;
}

/**
 * GET ?since=&level=: powers the /logs page's poll loop (lib/use-logs-poll.ts).
 * With `since` (an ISO created_at cursor), returns only newer rows, oldest
 * first, so the client can append them and advance its cursor. Without it,
 * returns the most recent rows, newest first, for a fresh load.
 *
 * Admin-only: the page itself gates this, but the poll loop hits this route
 * directly, so it needs its own check (a non-admin could otherwise poll it
 * straight from the network tab).
 */
export async function GET(req: NextRequest) {
  try {
    if (isSupabaseAuthConfigured()) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const role = user && isSupabaseConfigured() ? await getUserRole(user.id) : "user";
      if (role !== "admin") {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
    }

    const since = req.nextUrl.searchParams.get("since");
    const level = parseLevel(req.nextUrl.searchParams.get("level"));
    const logs = since
      ? await listLogsSince(since, { level })
      : await listRecentLogs({ level });
    return NextResponse.json({ logs });
  } catch (err) {
    logError("api:/api/logs/recent", err);
    return NextResponse.json({ error: "Failed to load logs." }, { status: 500 });
  }
}
