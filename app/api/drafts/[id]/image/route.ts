import { NextRequest, NextResponse } from "next/server";
import { getDraftWithJobContext, getTopicContext } from "@/lib/db/queries";
import { resolveBrandTokens } from "@/lib/email/templates";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";
import { accumulateUsage } from "@/lib/pipeline/cost";
import {
  generateContentImage,
  removeHeroImage,
  spliceHeroImage,
} from "@/lib/pipeline/generate-image";
import type { ContentImageStyle } from "@/lib/db/types";

// A Gemini render + Haiku prompt-craft + optimize + upload usually lands in
// 10-25s, but leave headroom for retries and cold storage buckets.
export const maxDuration = 120;

const STYLES: ContentImageStyle[] = ["illustration", "photo", "texture"];

/**
 * POST { style, subject? }: generates a brand-grounded hero image and places
 * it in the draft's HTML (replacing any existing one). Opt-in per draft,
 * never automatic, that's the cost-control contract.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      style?: string;
      subject?: string;
    };

    const style = (body.style ?? "") as ContentImageStyle;
    if (!STYLES.includes(style)) {
      return NextResponse.json({ error: "Pick an image style." }, { status: 400 });
    }

    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }
    const topicCtx = await getTopicContext(draftCtx.topicId);
    if (!topicCtx) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const { image, usage } = await generateContentImage({
      tokens: resolveBrandTokens(topicCtx.brand),
      brandName: topicCtx.brand.name,
      topicTitle: topicCtx.topic.title,
      headline: draftCtx.meta.email_copy?.headline,
      style,
      subject: body.subject?.trim() || undefined,
    });

    const spliced = spliceHeroImage(draftCtx.content.html, image);
    if (!spliced) {
      return NextResponse.json(
        { error: "Couldn't find a place for the image in this design." },
        { status: 422 },
      );
    }

    let rolled = draftCtx.meta.usage;
    for (const delta of usage) rolled = accumulateUsage(rolled, delta);

    const result = await commitHtmlEdit({
      draftCtx,
      html: spliced,
      label: `Added a ${style} hero image`,
      type: "image",
      extraMeta: { hero_image: image, usage: rolled },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history, image });
  } catch (err) {
    console.error("[image] error", err);
    const message =
      err instanceof Error ? err.message : "Couldn't generate the image. Try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE: removes the hero image from the draft's HTML (storage object stays; cheap and reusable via undo). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }

    const stripped = removeHeroImage(draftCtx.content.html);
    if (stripped === draftCtx.content.html) {
      return NextResponse.json({ error: "This email has no image." }, { status: 400 });
    }

    const result = await commitHtmlEdit({
      draftCtx,
      html: stripped,
      label: "Removed the hero image",
      type: "image",
      extraMeta: { hero_image: undefined },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history });
  } catch (err) {
    console.error("[image] delete error", err);
    return NextResponse.json(
      { error: "Couldn't remove the image. Try again." },
      { status: 500 },
    );
  }
}
