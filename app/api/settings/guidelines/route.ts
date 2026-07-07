import { NextRequest, NextResponse } from "next/server";
import {
  DRAFT_MODEL,
  getAnthropic,
  isAnthropicConfigured,
  logUsage,
} from "@/lib/clients/anthropic";
import {
  getBrandWithIcps,
  listProducts,
  updateBrandGuidelines,
} from "@/lib/db/queries";
import type { BrandGuidelines } from "@/lib/db/types";
import {
  GUIDELINES_TOOL,
  buildGuidelinesMessages,
  type GuidelinesToolInput,
} from "@/prompts/guidelines";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";

export const maxDuration = 120;

/**
 * POST: synthesize a guidelines PROPOSAL from everything stored about the
 * brand. Never persists; the client fills the form with it and the human
 * edits, then saves via PATCH.
 */
export async function POST() {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY in .env.local." },
      { status: 503 },
    );
  }
  try {
    const data = await getBrandWithIcps();
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }
    const products = await listProducts(data.brand.id);
    const { system, user } = buildGuidelinesMessages({ ...data, products });

    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
      tools: [GUIDELINES_TOOL],
      tool_choice: { type: "tool", name: "save_brand_guidelines" },
    });
    logUsage("guidelines-synthesis", DRAFT_MODEL, response.usage);

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_brand_guidelines",
    );
    if (!tu || tu.type !== "tool_use") {
      return NextResponse.json(
        { error: "The model returned no guidelines. Try again." },
        { status: 502 },
      );
    }

    const raw = tu.input as GuidelinesToolInput;
    const clean = (s?: string) => (s ? stripEmDashes(s.trim()) : undefined);
    const cleanList = (l?: string[]) =>
      l?.map((s) => stripEmDashes(s.trim())).filter(Boolean);

    const proposal: BrandGuidelines = {
      voice_and_tone: clean(raw.voice_and_tone),
      messaging_pillars: cleanList(raw.messaging_pillars),
      do_language: cleanList(raw.do_language),
      dont_language: cleanList(raw.dont_language),
      audience_summary: clean(raw.audience_summary),
      visual_direction: clean(raw.visual_direction),
      cta_philosophy: clean(raw.cta_philosophy),
    };

    return NextResponse.json({ proposal });
  } catch (err) {
    logError("api:/api/settings/guidelines:post", err);
    return NextResponse.json(
      { error: "Failed to generate guidelines." },
      { status: 500 },
    );
  }
}

/** PATCH: the explicit human save. Stamps approved_at. */
export async function PATCH(req: NextRequest) {
  try {
    const { brandId, guidelines } = (await req.json()) as {
      brandId?: string;
      guidelines?: BrandGuidelines;
    };
    if (!brandId || !guidelines) {
      return NextResponse.json(
        { error: "brandId and guidelines are required" },
        { status: 400 },
      );
    }
    await updateBrandGuidelines(brandId, {
      ...guidelines,
      approved_at: new Date().toISOString(),
    });
    return NextResponse.json({ saved: true });
  } catch (err) {
    logError("api:/api/settings/guidelines:patch", err);
    return NextResponse.json(
      { error: "Failed to save guidelines" },
      { status: 500 },
    );
  }
}
