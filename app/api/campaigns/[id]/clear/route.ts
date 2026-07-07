import { NextRequest, NextResponse } from "next/server";
import { updateCampaign } from "@/lib/db/queries";
import { logError } from "@/lib/log";

/**
 * POST: marks a campaign "done" so it stops being resumed. Used by the
 * chat's "Clear chat" button; reuses the existing status field rather than a
 * hard delete, since getLatestActiveCampaign already excludes done campaigns
 * from resume hydration.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await updateCampaign(id, { status: "done" });
    return NextResponse.json({ cleared: true });
  } catch (err) {
    logError("api:/api/campaigns/[id]/clear:post", err);
    return NextResponse.json({ error: "Failed to clear chat." }, { status: 500 });
  }
}
