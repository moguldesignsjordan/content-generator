import { NextRequest, NextResponse } from "next/server";
import { getSingleBrand, updateBrandVoice } from "@/lib/db/queries";
import type { VoiceExample, VoiceProfile } from "@/lib/db/types";
import type { VoiceProposals } from "@/prompts/campaign";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";

/**
 * The explicit-confirm write path for voice proposals from the campaign chat.
 * Only runs when the user taps Save on the confirm card; merges the proposals
 * into voice_profile (never replaces unrelated fields).
 */
export async function POST(req: NextRequest) {
  try {
    const { proposals } = (await req.json()) as { proposals?: VoiceProposals };
    if (!proposals) {
      return NextResponse.json({ error: "proposals is required" }, { status: 400 });
    }

    const brand = await getSingleBrand();
    if (!brand) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }

    const cur: VoiceProfile = brand.voice_profile ?? {};

    const bannedAdd = (proposals.banned_terms_add ?? [])
      .map((t) => t.trim())
      .filter(Boolean);
    const banned = Array.from(new Set([...(cur.banned_terms ?? []), ...bannedAdd]));

    const exampleAdd: VoiceExample[] = (proposals.example_lines ?? [])
      .map((l) => stripEmDashes(l.trim()))
      .filter(Boolean)
      .map((content) => ({ channel: "email" as const, content }));

    const next: VoiceProfile = {
      ...cur,
      ...(proposals.voice?.trim() && { voice: stripEmDashes(proposals.voice.trim()) }),
      ...(proposals.tone?.trim() && { tone: stripEmDashes(proposals.tone.trim()) }),
      ...(banned.length && { banned_terms: banned }),
      ...(exampleAdd.length && { examples: [...(cur.examples ?? []), ...exampleAdd] }),
    };

    await updateBrandVoice(brand.id, next);
    return NextResponse.json({ saved: true });
  } catch (err) {
    logError("api:/api/campaigns/apply-voice", err);
    return NextResponse.json(
      { error: "Failed to save voice updates" },
      { status: 500 },
    );
  }
}
