import { NextRequest, NextResponse } from "next/server";
import { isDataForSeoConfigured } from "@/lib/clients/dataforseo";
import { researchKeyword } from "@/lib/keyword/research";
import { getSingleBrand, getTopicContext, updateTopicKeywordData } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

export const maxDuration = 60;

/**
 * POST: validates a topic's target_keyword against real DataForSEO numbers
 * (volume/difficulty/intent/cpc + a few secondary keywords) and persists the
 * result on topics.keyword_data. Explicit per-topic trigger, no auto-spend.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDataForSeoConfigured()) {
    return NextResponse.json(
      { error: "Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to .env.local." },
      { status: 503 },
    );
  }
  try {
    const { id } = await params;
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }
    const ctx = await getTopicContext(id);
    if (!ctx || ctx.brand.id !== brand.id) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }
    if (!ctx.topic.target_keyword?.trim()) {
      return NextResponse.json(
        { error: "This topic has no target keyword to research yet." },
        { status: 400 },
      );
    }
    const keywordData = await researchKeyword(
      ctx.topic.target_keyword,
      ctx.brand.seo_defaults,
    );
    await updateTopicKeywordData(id, keywordData);
    return NextResponse.json({ keywordData });
  } catch (err) {
    logError("api:/api/topics/[id]/research", err);
    return NextResponse.json(
      { error: "Keyword research failed. Try again." },
      { status: 500 },
    );
  }
}
