import { NextRequest, NextResponse } from "next/server";
import { getDueSchedules } from "@/lib/db/queries";
import { runDueSchedule } from "@/lib/pipeline/run-schedule";

// Sequential per-schedule generation (each ~30-90s); comfortable at the
// one-brand/few-schedules volume expected for this cut. Matches the existing
// SSE route's ceiling.
export const maxDuration = 300;

/**
 * Vercel Cron's daily tick (see vercel.json). Fails closed: 503 if
 * CRON_SECRET isn't configured at all (this triggers real Claude spend,
 * unlike other integrations that degrade gracefully), 401 if the header is
 * missing or wrong.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await getDueSchedules();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const schedule of due) {
    const result = await runDueSchedule(schedule);
    if (result.status === "generated") generated++;
    else if (result.status === "skipped") skipped++;
    else failed++;
  }

  return NextResponse.json({ processed: due.length, generated, skipped, failed });
}

export const GET = handle;
export const POST = handle;
