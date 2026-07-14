import { NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { isGeminiConfigured } from "@/lib/clients/gemini-image";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  createDraftShell,
  getDraftWithJobContext,
  getTopicContext,
} from "@/lib/db/queries";
import { guardAiRoute } from "@/lib/ai-guard";

/**
 * Spins a social flyer off an existing email draft, no re-briefing: resolves
 * the source draft's topic and creates a social shell on that same topic with
 * meta.source_draft_id set, so the flyer pipeline distills the EMAIL's copy
 * (meta.email_copy) instead of starting from the bare topic. Same
 * shell-then-SSE shape as create-blog: this route only does fast DB writes.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured() || !isAnthropicConfigured()) {
    return NextResponse.json(
      {
        error:
          "Missing configuration. Set SUPABASE_* and ANTHROPIC_API_KEY in .env.local.",
      },
      { status: 503 },
    );
  }
  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "Image generation isn't set up yet: add GEMINI_API_KEY to .env.local." },
      { status: 503 },
    );
  }

  const { id: sourceDraftId } = await params;

  const source = await getDraftWithJobContext(sourceDraftId);
  if (!source || !source.topicId) {
    return NextResponse.json(
      { error: "This draft has no topic to build a flyer from." },
      { status: 404 },
    );
  }

  const ctx = await getTopicContext(source.topicId);
  if (!ctx) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  const guard = await guardAiRoute("generate", { brandId: ctx.brand.id, limit: 8 });
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error, outOfCredits: guard.outOfCredits, upgradeUrl: guard.upgradeUrl },
      { status: guard.status },
    );
  }

  try {
    const draftId = await createDraftShell({
      ctx,
      campaignId: source.campaignId ?? undefined,
      type: "social",
      sourceDraftId,
      flyerAspect: "1:1",
    });
    return NextResponse.json({ draftId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start the flyer." },
      { status: 500 },
    );
  }
}
