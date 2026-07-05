import { NextRequest, NextResponse } from "next/server";
import { getDraftWithJobContext, getTopicContext } from "@/lib/db/queries";
import { resolveBrandTokens } from "@/lib/email/templates";
import { commitHtmlEdit } from "@/lib/pipeline/html-edit";
import { accumulateUsage } from "@/lib/pipeline/cost";
import {
  generateContentImage,
  removeHeroImage,
  saveUploadedHeroImage,
  spliceHeroImage,
} from "@/lib/pipeline/generate-image";
import { prepareReferenceImage } from "@/lib/images/optimize";
import { IMAGE_STYLE_LABELS } from "@/prompts/generate-image";
import type { ContentImage, ContentImageStyle, ReferenceUse } from "@/lib/db/types";
import type { UsageDelta } from "@/lib/pipeline/cost";

// A Gemini render + Haiku prompt-craft + optimize + upload usually lands in
// 10-25s, but leave headroom for retries and cold storage buckets.
export const maxDuration = 120;

const STYLES = Object.keys(IMAGE_STYLE_LABELS) as ContentImageStyle[];
const REFERENCE_USES: ReferenceUse[] = ["style", "subject", "both"];
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

/**
 * POST multipart/form-data:
 *  - mode "generate" (default): { style, subject?, reference?, referenceUse? }
 *    generates a brand-grounded hero image, optionally steered by an attached
 *    reference image. Opt-in per draft, never automatic (cost control).
 *  - mode "upload": { file, alt? } places the user's own image as the hero.
 *    No AI involved.
 * Either way the image lands in the draft's HTML, replacing any existing hero.
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

    let image: ContentImage;
    let usage: UsageDelta[] = [];
    let label: string;

    if (mode === "upload") {
      const read = readImageFile(form, "file");
      if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
      if (!read.file) {
        return NextResponse.json({ error: "Attach an image to upload." }, { status: 400 });
      }
      const alt =
        (form.get("alt") as string | null)?.trim() || topicCtx.topic.title;
      image = await saveUploadedHeroImage({
        file: Buffer.from(await read.file.arrayBuffer()),
        alt,
      });
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
        headline: draftCtx.meta.email_copy?.headline,
        style,
        subject,
        reference,
        referenceUse,
      });
      image = generated.image;
      usage = generated.usage;
      label = reference
        ? `Added a ${style} hero image from a reference`
        : `Added a ${style} hero image`;
    }

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
      label,
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
