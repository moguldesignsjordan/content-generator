import { NextRequest, NextResponse } from "next/server";
import { archiveCampaign } from "@/lib/db/queries";
import { logError } from "@/lib/log";

/**
 * POST: archives a campaign (hides it from the default Campaigns view).
 * Safe regardless of send/schedule state, unlike hard delete.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await archiveCampaign(id, true);
    return NextResponse.json({ archived: true });
  } catch (err) {
    logError("api:/api/campaigns/[id]/archive:post", err);
    return NextResponse.json({ error: "Failed to archive campaign." }, { status: 500 });
  }
}

/** DELETE: unarchives a campaign (brings it back into the default view). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await archiveCampaign(id, false);
    return NextResponse.json({ archived: false });
  } catch (err) {
    logError("api:/api/campaigns/[id]/archive:delete", err);
    return NextResponse.json({ error: "Failed to unarchive campaign." }, { status: 500 });
  }
}
