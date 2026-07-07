import { NextRequest, NextResponse } from "next/server";
import { listLogsSince, listRecentLogs } from "@/lib/db/queries";
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
 */
export async function GET(req: NextRequest) {
  try {
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
