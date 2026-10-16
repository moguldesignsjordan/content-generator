import { NextRequest, NextResponse } from "next/server";
import {
  deleteDraft,
  getDraftWithJobContext,
  getSingleBrand,
  isJobPublished,
} from "@/lib/db/queries";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

/**
 * POST { draftIds }: hard-deletes the listed drafts (Review and the kind
 * lists' bulk delete). Same rules as the single DELETE /api/drafts/[id]:
 * only the caller's brand's drafts, and published ones are skipped and
 * counted, since a published draft is a permanent record.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { draftIds?: unknown };
    const draftIds = Array.isArray(body.draftIds)
      ? body.draftIds.filter((v): v is string => typeof v === "string").slice(0, 100)
      : [];
    if (!draftIds.length) {
      return NextResponse.json({ error: "Nothing to delete." }, { status: 400 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ error: "No brand found." }, { status: 404 });

    let deleted = 0;
    let published = 0;
    for (const draftId of draftIds) {
      const draft = await getDraftWithJobContext(draftId, brand.id);
      if (!draft) continue;
      if (draft.jobId && (await isJobPublished(draft.jobId))) {
        published++;
        continue;
      }
      await deleteDraft(draftId);
      deleted++;
    }
    return NextResponse.json({ deleted, published });
  } catch (err) {
    logError("api:/api/drafts/delete-many", err);
    return NextResponse.json({ error: "Couldn't delete them. Try again." }, { status: 500 });
  }
}
