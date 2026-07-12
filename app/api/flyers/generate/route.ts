import { NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { isGeminiConfigured } from "@/lib/clients/gemini-image";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  createDraftShell,
  createTopic,
  ensureDefaultCluster,
  getBrandStrategy,
  getTopicContext,
} from "@/lib/db/queries";
import { DEFAULT_FLYER_ASPECT, isFlyerAspect } from "@/prompts/generate-flyer";
import type { FlyerAspect } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { guardAiRoute } from "@/lib/ai-guard";

// Starts a social flyer draft. Two entry shapes:
//   { topicId }          — flyer from an existing topic
//   { title, brief? }    — standalone: mints a topic in the default cluster
// plus { aspect?, styleReferenceId? } on either. Like /api/generate this only
// does fast DB writes and returns { draftId }; the review page's SSE stream
// drives the actual generation.

export async function POST(request: Request) {
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

  // Rate + daily-budget brake before any DB write or downstream model spend.
  const guard = await guardAiRoute("generate", { limit: 8 });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let topicId: string | undefined;
  let title: string | undefined;
  let brief: string | undefined;
  let aspect: FlyerAspect = DEFAULT_FLYER_ASPECT;
  let styleReferenceId: string | undefined;
  try {
    const body = await request.json();
    topicId = body?.topicId || undefined;
    title = typeof body?.title === "string" ? body.title.trim() || undefined : undefined;
    brief = typeof body?.brief === "string" ? body.brief.trim() || undefined : undefined;
    if (isFlyerAspect(body?.aspect)) aspect = body.aspect;
    styleReferenceId = body?.styleReferenceId || undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!topicId && !title) {
    return NextResponse.json(
      { error: "Pass a topicId, or a title for a standalone flyer." },
      { status: 400 },
    );
  }

  try {
    // Standalone path: every draft hangs off a topic (createDraftShell and the
    // SSE stream both resolve topic context), so mint one from the title in
    // the strategy's default cluster. The richer creative brief travels on
    // meta.flyer_brief.
    if (!topicId) {
      const strategyData = await getBrandStrategy();
      if (!strategyData) {
        return NextResponse.json(
          { error: "No brand strategy found. Seed or onboard a brand first." },
          { status: 404 },
        );
      }
      const clusterId = await ensureDefaultCluster(strategyData.strategy.id);
      const topic = await createTopic(clusterId, {
        title: title!,
        target_keyword: "",
        intent: "",
        funnel_stage: "",
        maps_to_product: "",
      });
      topicId = topic.id;
    }

    const ctx = await getTopicContext(topicId);
    if (!ctx) {
      return NextResponse.json({ error: `Topic ${topicId} not found.` }, { status: 404 });
    }

    const draftId = await createDraftShell({
      ctx,
      type: "social",
      flyerAspect: aspect,
      flyerBrief: brief,
      styleReferenceId,
    });
    return NextResponse.json({ draftId });
  } catch (err) {
    logError("api:/api/flyers/generate", err, { topicId });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed." },
      { status: 500 },
    );
  }
}
