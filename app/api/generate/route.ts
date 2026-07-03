import { NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { isSupabaseConfigured } from "@/lib/db/client";
import { generateEmailForTopic } from "@/lib/pipeline/generate";

// A full generation (Claude + adaptive thinking) can take 30 to 90s, which exceeds
// the default serverless timeout. Give the route headroom (Guardrail #6).
// Vercel allows up to 300s on Pro/Fluid Compute.
export const maxDuration = 300;

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

  let topicId: string | undefined;
  let campaignId: string | undefined;
  try {
    const body = await request.json();
    topicId = body?.topicId;
    campaignId = body?.campaignId || undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!topicId) {
    return NextResponse.json({ error: "topicId is required." }, { status: 400 });
  }

  try {
    console.log("[generate] start topicId:", topicId, "campaignId:", campaignId);
    const draftId = await generateEmailForTopic(topicId, { campaignId });
    console.log("[generate] success topicId:", topicId, "draftId:", draftId);
    return NextResponse.json({ draftId });
  } catch (err) {
    console.error(
      "[generate] failed topicId:",
      topicId,
      err instanceof Error ? err.message : err,
    );
    if (err instanceof Error && err.stack) {
      console.error("[generate] stack:", err.stack);
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed." },
      { status: 500 },
    );
  }
}
