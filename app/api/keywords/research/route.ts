import { NextRequest, NextResponse } from "next/server";
import { isDataForSeoConfigured } from "@/lib/clients/dataforseo";
import { researchKeyword } from "@/lib/keyword/research";
import { getSingleBrand } from "@/lib/db/queries";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST: validates a raw keyword against real DataForSEO numbers before it's
 * attached to any topic. Used by topic-idea proposals (nothing persists here;
 * the topic itself only saves keyword_data once it's a real row, via
 * POST /api/topics/[id]/research).
 */
export async function POST(req: NextRequest) {
  if (!isDataForSeoConfigured()) {
    return NextResponse.json(
      { error: "Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to .env.local." },
      { status: 503 },
    );
  }
  try {
    const { keyword } = (await req.json()) as { keyword?: string };
    if (!keyword?.trim()) {
      return NextResponse.json({ error: "No keyword given." }, { status: 400 });
    }
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const keywordData = await researchKeyword(keyword.trim(), brand.seo_defaults);
    return NextResponse.json({ keywordData });
  } catch (err) {
    logError("api:/api/keywords/research", err);
    return NextResponse.json(
      { error: "Keyword research failed. Try again." },
      { status: 500 },
    );
  }
}
