import { NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  createDraftShell,
  getDraftWithJobContext,
  getTopicContext,
} from "@/lib/db/queries";

/**
 * Spins a blog draft off an existing (email) draft, no re-briefing: resolves
 * the source draft's topic (and campaign, if any) and creates a blog shell on
 * that same topic. The blog pipeline then generates fresh long-form,
 * search-optimized content from the topic independently of the email. The new
 * draft's review page picks up the actual generation via the SSE stream, so
 * this route only does fast DB writes and returns immediately (same shape as
 * /api/generate).
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

  const { id: sourceDraftId } = await params;

  const source = await getDraftWithJobContext(sourceDraftId);
  if (!source || !source.topicId) {
    return NextResponse.json(
      { error: "This draft has no topic to build a blog post from." },
      { status: 404 },
    );
  }

  const ctx = await getTopicContext(source.topicId);
  if (!ctx) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  try {
    const draftId = await createDraftShell({
      ctx,
      campaignId: source.campaignId ?? undefined,
      type: "blog",
    });
    return NextResponse.json({ draftId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start blog post." },
      { status: 500 },
    );
  }
}
