import { NextRequest, NextResponse } from "next/server";
import {
  getDraftWithJobContext,
  getTopicContext,
  updateDraftContent,
} from "@/lib/db/queries";
import { resolveBrandTokens } from "@/lib/email/templates";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";
import { accumulateUsage } from "@/lib/pipeline/cost";
import {
  generateContentImage,
  removeHeroImage,
  saveUploadedHeroImage,
  spliceHeroImage,
} from "@/lib/pipeline/generate-image";
import { renderBlogPreviewHtml } from "@/lib/blog/render-preview";
import { prepareReferenceImage } from "@/lib/images/optimize";
import { IMAGE_STYLE_LABELS } from "@/prompts/generate-image";
import type {
  ContentImage,
  ContentImageStyle,
  DraftJobContext,
  DraftMeta,
  HeroPlacement,
  ReferenceUse,
  TopicContext,
} from "@/lib/db/types";
import type { UsageDelta } from "@/lib/pipeline/cost";
import { logError } from "@/lib/log";

// A Gemini render + Haiku prompt-craft + optimize + upload usually lands in
// 10-25s, but leave headroom for retries and cold storage buckets.
export const maxDuration = 120;

const STYLES = Object.keys(IMAGE_STYLE_LABELS) as ContentImageStyle[];
const REFERENCE_USES: ReferenceUse[] = ["style", "subject", "both"];
const PLACEMENTS: HeroPlacement[] = ["top", "below_headline", "above_cta"];
// Generous input cap; everything is re-encoded server-side anyway.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Pulls a validated image file out of the form, or a readable error. */
function readImageFile(
  form: FormData,
  field: string,
): { ok: true; file: File | null } | { ok: false; error: string } {
  const value = form.get(field);
  if (value === null) return { ok: true, file: null };
  if (!(value instanceof File) || value.size === 0) {
    return { ok: false, error: "That upload didn't come through. Try again." };
  }
  if (!value.type.startsWith("image/")) {
    return { ok: false, error: "Only image files work here (JPEG, PNG, WebP)." };
  }
  if (value.size > MAX_FILE_BYTES) {
    return { ok: false, error: "That image is over 10MB. Use a smaller file." };
  }
  return { ok: true, file: value };
}

/** The requested placement, defaulting to the image's current spot, then "top". */
function readPlacement(form: FormData, current?: HeroPlacement): HeroPlacement {
  const raw = form.get("placement") as string | null;
  if (raw && PLACEMENTS.includes(raw as HeroPlacement)) return raw as HeroPlacement;
  return current ?? "top";
}

/**
 * Persists a new/updated hero on a BLOG draft: blogs re-render the whole
 * preview from blog_copy (the HTML is code-rendered, not model HTML, so the
 * email edit pipeline's validation/unsubscribe guarantees don't apply here).
 */
async function commitBlogHero(
  draftCtx: DraftJobContext,
  topicCtx: TopicContext,
  image: ContentImage | undefined,
  extraMeta: Partial<DraftMeta>,
): Promise<{ html: string } | { error: string }> {
  const copy = draftCtx.meta.blog_copy;
  if (!copy) return { error: "This blog draft has no stored copy yet." };
  const html = renderBlogPreviewHtml(copy, topicCtx.brand, image);
  await updateDraftContent(
    draftCtx.draftId,
    { ...draftCtx.content, html },
    { ...draftCtx.meta, ...extraMeta, hero_image: image },
  );
  return { html };
}

/**
 * POST multipart/form-data:
 *  - mode "generate" (default): { style, subject?, placement?, reference?,
 *    referenceUse? } generates a brand-grounded hero image, optionally steered
 *    by an attached reference image.
 *  - mode "upload": { file, alt?, placement? } places the user's own image as
 *    the hero. No AI involved.
 *  - mode "move": { placement } re-places the existing hero instantly, no
 *    model call and no new image.
 * Emails splice the image into the draft's HTML at the chosen placement;
 * blogs attach it as the post's hero (rendered under the title, published to
 * Sanity as the main image).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: "Send the image request as form data." },
        { status: 400 },
      );
    }
    const mode = (form.get("mode") ?? "generate") as string;

    const draftCtx = await getDraftWithJobContext(id);
    if (!draftCtx) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }
    const topicCtx = await getTopicContext(draftCtx.topicId);
    if (!topicCtx) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }
    const isBlog = draftCtx.jobType === "blog";

    let image: ContentImage;
    let usage: UsageDelta[] = [];
    let label: string;

    if (mode === "move") {
      const current = draftCtx.meta.hero_image;
      if (!current) {
        return NextResponse.json(
          { error: "This email has no image to move yet." },
          { status: 400 },
        );
      }
      image = { ...current, placement: readPlacement(form) };
      label = "Moved the image";
    } else if (mode === "upload") {
      const read = readImageFile(form, "file");
      if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
      if (!read.file) {
        return NextResponse.json({ error: "Attach an image to upload." }, { status: 400 });
      }
      const alt =
        (form.get("alt") as string | null)?.trim() || topicCtx.topic.title;
      image = {
        ...(await saveUploadedHeroImage({
          file: Buffer.from(await read.file.arrayBuffer()),
          alt,
        })),
        placement: readPlacement(form, draftCtx.meta.hero_image?.placement),
      };
      label = "Uploaded a hero image";
    } else {
      const style = (form.get("style") ?? "") as ContentImageStyle;
      if (!STYLES.includes(style)) {
        return NextResponse.json({ error: "Pick an image style." }, { status: 400 });
      }
      const read = readImageFile(form, "reference");
      if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
      const reference = read.file
        ? await prepareReferenceImage(Buffer.from(await read.file.arrayBuffer()))
        : undefined;
      const rawUse = form.get("referenceUse") as string | null;
      const referenceUse =
        reference && rawUse && REFERENCE_USES.includes(rawUse as ReferenceUse)
          ? (rawUse as ReferenceUse)
          : undefined;
      const subject = (form.get("subject") as string | null)?.trim() || undefined;

      const generated = await generateContentImage({
        tokens: resolveBrandTokens(topicCtx.brand),
        brandName: topicCtx.brand.name,
        topicTitle: topicCtx.topic.title,
        headline: isBlog
          ? draftCtx.meta.blog_copy?.title
          : draftCtx.meta.email_copy?.headline,
        style,
        subject,
        reference,
        referenceUse,
      });
      image = {
        ...generated.image,
        placement: readPlacement(form, draftCtx.meta.hero_image?.placement),
      };
      usage = generated.usage;
      label = reference
        ? `Added a ${style} hero image from a reference`
        : `Added a ${style} hero image`;
    }

    let rolled = draftCtx.meta.usage;
    for (const delta of usage) rolled = accumulateUsage(rolled, delta);

    if (isBlog) {
      const result = await commitBlogHero(draftCtx, topicCtx, image, {
        usage: rolled,
      });
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 422 });
      }
      return NextResponse.json({ html: result.html, image });
    }

    const spliced = spliceHeroImage(draftCtx.content.html, image);
    if (!spliced) {
      return NextResponse.json(
        { error: "Couldn't find a place for the image in this design." },
        { status: 422 },
      );
    }

    const result = await commitHtmlEdit({
      draftCtx,
      html: spliced,
      label,
      type: "image",
      extraMeta: { hero_image: image, usage: rolled },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history, image });
  } catch (err) {
    logError("api:/api/drafts/[id]/image:post", err);
    const message =
      err instanceof Error ? err.message : "Couldn't generate the image. Try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE: removes the hero image from the draft (storage object stays; cheap and reusable via undo). */
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

    if (draftCtx.jobType === "blog") {
      if (!draftCtx.meta.hero_image) {
        return NextResponse.json({ error: "This post has no image." }, { status: 400 });
      }
      const topicCtx = await getTopicContext(draftCtx.topicId);
      if (!topicCtx) {
        return NextResponse.json({ error: "Topic not found." }, { status: 404 });
      }
      const result = await commitBlogHero(draftCtx, topicCtx, undefined, {});
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 422 });
      }
      return NextResponse.json({ html: result.html });
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
    logError("api:/api/drafts/[id]/image:delete", err);
    return NextResponse.json(
      { error: "Couldn't remove the image. Try again." },
      { status: 500 },
    );
  }
}
