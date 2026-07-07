import { NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/clients/anthropic";
import { isSupabaseConfigured } from "@/lib/db/client";
import { createDraftShell, getTopicContext } from "@/lib/db/queries";
import type { BlogType, EmailType } from "@/lib/db/types";
import { EMAIL_LENGTH_TARGETS } from "@/prompts/generate-email";
import { BLOG_LENGTH_TARGETS } from "@/prompts/generate-blog";
import { logError } from "@/lib/log";

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
  let channel: "email" | "blog" = "email";
  // Manual override of the derived email_type/blog_type (migration 005). No
  // UI sets these yet; they exist so the override path can be exercised
  // directly (e.g. via curl) ahead of a settings-form control.
  let emailType: EmailType | undefined;
  let blogType: BlogType | undefined;
  try {
    const body = await request.json();
    topicId = body?.topicId;
    campaignId = body?.campaignId || undefined;
    if (body?.channel === "blog") channel = "blog";
    if (body?.emailType in EMAIL_LENGTH_TARGETS) {
      emailType = body.emailType as EmailType;
    }
    if (body?.blogType in BLOG_LENGTH_TARGETS) {
      blogType = body.blogType as BlogType;
    }
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
    const draftId = await createDraftShell({
      ctx,
      campaignId,
      type: channel,
      emailType,
      blogType,
    });
    console.log("[generate] shell created topicId:", topicId, "draftId:", draftId);
    return NextResponse.json({ draftId });
  } catch (err) {
    logError("api:/api/generate", err, { topicId });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed." },
      { status: 500 },
    );
  }
}
