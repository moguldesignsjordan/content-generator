import { NextRequest, NextResponse } from "next/server";
import { approveDraft, getDraftWithJobContext, getSingleBrand } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

/**
 * POST { draftIds } → approves every listed social draft that belongs to the
 * caller's brand and is still waiting for review. This is the weekly batch's
 * one human approval: each draft gets the same approvals row a single
 * Approve click writes. Anything else in the list (another brand's, already
 * approved, still generating, not a flyer) is skipped, never an error.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { draftIds?: unknown };
    const draftIds = Array.isArray(body.draftIds)
      ? body.draftIds.filter((v): v is string => typeof v === "string").slice(0, 50)
      : [];
    if (!draftIds.length) {
      return NextResponse.json({ error: "No posts to approve." }, { status: 400 });
    }

    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ error: "No brand found." }, { status: 404 });

    let approved = 0;
    for (const id of draftIds) {
      const draft = await getDraftWithJobContext(id, brand.id);
      if (!draft || draft.jobType !== "social" || draft.state !== "in_review") continue;
      if (!draft.meta.flyer_image) continue;
      await approveDraft(id);
      approved++;
    }
    return NextResponse.json({ approved, skipped: draftIds.length - approved });
  } catch (err) {
    logError("api:/api/social/approve-week", err);
    return NextResponse.json({ error: "Couldn't approve the posts. Try again." }, { status: 500 });
  }
}
