import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { getCampaign, getDraftWithJobContext, getSingleBrand } from "@/lib/db/queries";
import type { Campaign, DraftJobContext } from "@/lib/db/types";

type DraftAccessOk = { ok: true; brandId: string; draft: DraftJobContext };
type DraftAccessFail = { ok: false; response: NextResponse };
type CampaignAccessOk = { ok: true; brandId: string; campaign: Campaign };
type CampaignAccessFail = { ok: false; response: NextResponse };

/**
 * Every /api/drafts/[id]/* route must call this before reading or mutating a
 * draft: resolves the caller's session + brand, then confirms the draft
 * belongs to it via content_jobs.brand_id (see getDraftWithJobContext). A
 * draft that exists but belongs to another brand returns the same 404 as one
 * that doesn't exist at all, so a route can never be used to probe which
 * case it is.
 */
export async function requireDraftInBrand(
  draftId: string,
): Promise<DraftAccessOk | DraftAccessFail> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }
  const brand = await getSingleBrand(user.id);
  if (!brand) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No brand found." }, { status: 404 }),
    };
  }
  const draft = await getDraftWithJobContext(draftId, brand.id);
  if (!draft) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Draft not found." }, { status: 404 }),
    };
  }
  return { ok: true, brandId: brand.id, draft };
}

/**
 * Same contract as requireDraftInBrand, for /api/campaigns/[id]/* routes:
 * resolves the caller's session + brand, then confirms the campaign belongs
 * to it via campaigns.brand_id before any read or mutation.
 */
export async function requireCampaignInBrand(
  campaignId: string,
): Promise<CampaignAccessOk | CampaignAccessFail> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }
  const brand = await getSingleBrand(user.id);
  if (!brand) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No brand found." }, { status: 404 }),
    };
  }
  const campaign = await getCampaign(campaignId);
  if (!campaign || campaign.brand_id !== brand.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Campaign not found." }, { status: 404 }),
    };
  }
  return { ok: true, brandId: brand.id, campaign };
}
