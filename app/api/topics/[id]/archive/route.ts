import { NextRequest, NextResponse } from "next/server";
import { archiveTopic } from "@/lib/db/queries";
import { logError } from "@/lib/log";

/**
 * POST: archives a topic (hides it from the default Content Plan view).
 * Safe for any status, unlike hard delete which stays idea-only.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await archiveTopic(id, true);
    return NextResponse.json({ archived: true });
  } catch (err) {
    logError("api:/api/topics/[id]/archive:post", err);
    return NextResponse.json({ error: "Failed to archive topic." }, { status: 500 });
  }
}

/** DELETE: unarchives a topic (brings it back into the default view). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await archiveTopic(id, false);
    return NextResponse.json({ archived: false });
  } catch (err) {
    logError("api:/api/topics/[id]/archive:delete", err);
    return NextResponse.json({ error: "Failed to unarchive topic." }, { status: 500 });
  }
}
