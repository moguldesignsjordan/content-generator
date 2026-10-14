import { NextRequest, NextResponse } from "next/server";
import { getSingleBrand } from "@/lib/db/queries";
import { loadOwnFactoryCampaign } from "@/lib/factory/access";
import { approveReadyDrafts } from "@/lib/pipeline/approve-batch";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

/**
 * POST: approves every finished piece of a factory campaign that's still
 * waiting for review (see approveReadyDrafts for what's skipped and why).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const owned = await loadOwnFactoryCampaign(id);
    if (owned instanceof NextResponse) return owned;
    const { campaign, brandId } = owned;

    const user = await getSessionUser();
    const brand = user ? await getSingleBrand(user.id) : null;
    const bannedTerms = brand?.voice_profile?.banned_terms ?? [];

    const draftIds = (campaign.chat_state.factory?.plan ?? [])
      .map((i) => i.draft_id)
      .filter((d): d is string => Boolean(d));

    const { approved, needsLook } = await approveReadyDrafts(brandId, draftIds, bannedTerms);
    return NextResponse.json({ approved, needsLook });
  } catch (err) {
    logError("api:/api/campaigns/[id]/approve-all", err);
    return NextResponse.json({ error: "Couldn't approve the pieces. Try again." }, { status: 500 });
  }
}
