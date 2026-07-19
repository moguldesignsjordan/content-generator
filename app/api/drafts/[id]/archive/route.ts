import { NextRequest, NextResponse } from "next/server";
import { archiveDraft } from "@/lib/db/queries";
import { requireDraftInBrand } from "@/lib/draft-access";
import { logError } from "@/lib/log";

/**
 * POST: archives a draft (hides it from the default Emails list) without
 * deleting its content or approval history.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    await archiveDraft(id, true);
    return NextResponse.json({ archived: true });
  } catch (err) {
    logError("api:/api/drafts/[id]/archive:post", err);
    return NextResponse.json({ error: "Failed to archive draft." }, { status: 500 });
  }
}

/** DELETE: unarchives a draft (brings it back into the default Emails list). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    await archiveDraft(id, false);
    return NextResponse.json({ archived: false });
  } catch (err) {
    logError("api:/api/drafts/[id]/archive:delete", err);
    return NextResponse.json({ error: "Failed to unarchive draft." }, { status: 500 });
  }
}
