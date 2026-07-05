import { NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { isSupabaseConfigured } from "@/lib/db/client";
import { createDraftShell, getTopicContext } from "@/lib/db/queries";

// Only creates the draft shell here (fast DB writes) and returns immediately.
// The actual generation runs when the draft page opens the generate-stream
// SSE connection, so this route no longer needs serverless-timeout headroom.

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
    const ctx = await getTopicContext(topicId);
    if (!ctx) {
      return NextResponse.json({ error: `Topic ${topicId} not found.` }, { status: 404 });
    }
    const draftId = await createDraftShell({ ctx, campaignId });
    console.log("[generate] shell created topicId:", topicId, "draftId:", draftId);
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
