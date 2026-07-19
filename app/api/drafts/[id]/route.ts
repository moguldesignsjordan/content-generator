import { NextResponse } from "next/server";
import { deleteDraft, isJobPublished } from "@/lib/db/queries";
import { requireDraftInBrand } from "@/lib/draft-access";

/**
 * Hard-deletes a draft. Published drafts are blocked (409): once a piece of
 * content has gone out to MailerLite or Sanity, the draft is a permanent
 * record and should be archived, not deleted. Everything else (in-review,
 * approved-not-published, rejected) is deletable.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await requireDraftInBrand(id);
  if (!access.ok) return access.response;
  const ctx = access.draft;

  if (ctx.jobId && (await isJobPublished(ctx.jobId))) {
    return NextResponse.json(
      {
        error:
          "This draft has been published, so it can't be deleted. Archive it instead.",
      },
      { status: 409 },
    );
  }

  try {
    await deleteDraft(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete draft." },
      { status: 500 },
    );
  }
}
