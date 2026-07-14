import { NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { getBrandWithIcps } from "@/lib/db/queries";
import type { BrandImportProposal } from "@/lib/db/types";
import { generateBrandIdentity } from "@/lib/pipeline/brand-identity";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Cheap, non-thinking, single forced tool call: no scraping, no drafting
// prose, just picking a palette and a font pairing. Comfortably fast on
// FAST_MODEL, so no need for the 120-300s budget the drafting routes need.
export const maxDuration = 60;

/**
 * POST: generates a from-scratch visual-identity PROPOSAL (palette + font
 * pairing) for brands with no website to import from, grounded in whatever
 * voice/positioning is already saved. Never persists; the client reviews and
 * saves via the existing visual-identity PATCH route.
 */
export async function POST() {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY in .env.local." },
      { status: 503 },
    );
  }
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const data = await getBrandWithIcps(user.id);
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const { brand } = data;

    const result = await generateBrandIdentity({
      brandName: brand.name,
      positioning: brand.positioning ?? {},
      voiceProfile: brand.voice_profile ?? {},
    });
    if (!result) {
      return NextResponse.json(
        { error: "The model returned no identity. Try again." },
        { status: 502 },
      );
    }

    const proposal: BrandImportProposal = {
      visual_identity: {
        logo_alt: brand.name,
        colors: result.colors,
        fonts: result.fonts,
      },
    };

    return NextResponse.json({ proposal, reasoning: result.reasoning });
  } catch (err) {
    logError("api:/api/settings/brand-identity", err);
    return NextResponse.json(
      { error: "Couldn't generate an identity. Try again." },
      { status: 500 },
    );
  }
}
