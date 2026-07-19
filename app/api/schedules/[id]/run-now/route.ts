import { NextRequest, NextResponse } from "next/server";
import { getContentSchedule, getSingleBrand } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { runDueSchedule } from "@/lib/pipeline/run-schedule";

// Manual trigger for testing without waiting on the daily cron tick. Same
// auth posture as the rest of /api/settings/*: behind the app's own session
// gate, not CRON_SECRET (that's only for the real cron endpoint).
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const brand = await getSingleBrand(user.id);
  if (!brand) {
    return NextResponse.json({ error: "No brand found" }, { status: 404 });
  }
  const schedule = await getContentSchedule(id);
  if (!schedule || schedule.brand_id !== brand.id) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  const result = await runDueSchedule(schedule);
  return NextResponse.json(result);
}
