import "server-only";
import { NextResponse } from "next/server";
import { getBrandWithIcps, getCampaign } from "@/lib/db/queries";
import type { Campaign } from "@/lib/db/types";
import { getSessionUser } from "@/lib/supabase/server";

/** Loads a factory campaign only when it belongs to the signed-in user's
 * brand; otherwise returns the 401/404 response to send back. */
export async function loadOwnFactoryCampaign(
  campaignId: string,
): Promise<{ campaign: Campaign; brandId: string } | NextResponse> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const [data, campaign] = await Promise.all([
    getBrandWithIcps(sessionUser.id),
    getCampaign(campaignId),
  ]);
  if (!data || !campaign || campaign.brand_id !== data.brand.id || !campaign.chat_state?.factory) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  return { campaign, brandId: data.brand.id };
}
