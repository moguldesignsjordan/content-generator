import { NextRequest, NextResponse } from "next/server";
import {
  createMediaAsset,
  getBrandByDraftId,
  getTopicContext,
  updateDraftContent,
} from "@/lib/db/queries";
import { requireDraftInBrand } from "@/lib/draft-access";
import { accumulateUsage, type UsageDelta } from "@/lib/pipeline/cost";
import { regenerateFlyerImage } from "@/lib/pipeline/generate-flyer";
import { uploadContentImage } from "@/lib/pipeline/generate-image";
import { optimizeFlyerImage, prepareReferenceImage } from "@/lib/images/optimize";
import { DEFAULT_FLYER_ASPECT, FLYER_ASPECTS, isFlyerAspect } from "@/prompts/generate-flyer";
import { stripEmDashes } from "@/lib/text";
import type { ContentImage, DraftMeta, FlyerAspect, FlyerCopy } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { guardAiRoute } from "@/lib/ai-guard";

// A Gemini render + optimize + upload usually lands in 10-25s; headroom for
// retries and cold buckets, same as the hero-image route.
export const maxDuration = 120;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * POST multipart/form-data — edits to a social flyer draft. Modes:
 *  - "generate" (default): re-renders the design. { headline?, subtext?,
 *    cta?, scene?, aspect?, styleReferenceId?, reference?, exactPrompt? }.
 *    Copy fields default to the stored flyer_copy; exactPrompt sends the full
 *    prompt verbatim (the tweak-and-regenerate path). Zero Claude tokens
 *    either way, one Gemini render.
 *  - "upload": { file } replaces the design with the user's own image,
 *    cover-fitted to the flyer's post shape. No AI.
 *  - "caption": { caption, hashtags? } edits the post caption only. No AI,
 *    no image change.
 * Only in_review drafts are editable: an approved flyer is a publish record.
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
        { error: "Send the flyer request as form data." },
        { status: 400 },
      );
    }
    const mode = (form.get("mode") ?? "generate") as string;

    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;
    const draftCtx = access.draft;
    if (draftCtx.jobType !== "social") {
      return NextResponse.json({ error: "Not a flyer draft." }, { status: 400 });
    }
    if (draftCtx.state !== "in_review") {
      return NextResponse.json(
        { error: "This flyer is no longer in review, so it can't be edited." },
        { status: 409 },
      );
    }

    const meta = draftCtx.meta;
    const currentCopy = meta.flyer_copy;
    const aspect: FlyerAspect = readAspect(form, meta.flyer_aspect);

    // ── caption: plain text edit, instant ──────────────────────────────────
    if (mode === "caption") {
      const caption = stripEmDashes(String(form.get("caption") ?? "").trim());
      if (!caption) {
        return NextResponse.json({ error: "The caption can't be empty." }, { status: 400 });
      }
      const hashtags = String(form.get("hashtags") ?? "")
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter(Boolean)
        .map((h) => (h.startsWith("#") ? h : `#${h}`))
        .slice(0, 10);
      const flyerCopy: FlyerCopy = {
        headline: currentCopy?.headline ?? draftCtx.content.subject,
        ...(currentCopy?.subtext ? { subtext: currentCopy.subtext } : {}),
        ...(currentCopy?.cta ? { cta: currentCopy.cta } : {}),
        caption,
        ...(hashtags.length ? { hashtags } : {}),
      };
      await updateDraftContent(
        id,
        { ...draftCtx.content, preheader: caption.slice(0, 120) },
        { ...meta, flyer_copy: flyerCopy },
      );
      return NextResponse.json({ copy: flyerCopy });
    }

    // ── upload: the user's own design, cover-fit to the post shape ─────────
    if (mode === "upload") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "Attach an image to upload." }, { status: 400 });
      }
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Only image files work here (JPEG, PNG, WebP)." },
          { status: 400 },
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "That image is over 10MB. Use a smaller file." },
          { status: 400 },
        );
      }
      let optimized;
      try {
        optimized = await optimizeFlyerImage(
          Buffer.from(await file.arrayBuffer()),
          FLYER_ASPECTS[aspect],
        );
      } catch {
        return NextResponse.json(
          { error: "That file isn't a readable image. Try a JPEG or PNG." },
          { status: 400 },
        );
      }
      const { url, path } = await uploadContentImage(optimized.data);
      const alt = stripEmDashes(
        (currentCopy?.headline ?? draftCtx.content.subject ?? "Flyer").trim(),
      ).slice(0, 160);
      const image: ContentImage = {
        url,
        alt,
        width: optimized.width,
        height: optimized.height,
        style: "uploaded",
      };

      const brand = await getBrandByDraftId(id).catch(() => null);
      if (brand) {
        createMediaAsset({
          brandId: brand.id,
          url,
          storagePath: path,
          alt,
          kind: "flyer",
          source: "uploaded",
          width: optimized.width,
          height: optimized.height,
          originDraftId: id,
        }).catch((err) => logError("api:/api/drafts/[id]/flyer:record-media-asset", err));
      }

      await updateDraftContent(id, draftCtx.content, {
        ...meta,
        flyer_image: image,
        flyer_aspect: aspect,
      });
      return NextResponse.json({ image, aspect });
    }

    // ── generate: re-render the design (the only AI-spending mode) ─────────
    // Resolve the topic first: it's what tells us which brand is paying.
    const ctx = await getTopicContext(draftCtx.topicId);
    if (!ctx) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const guard = await guardAiRoute("image", { brandId: ctx.brand.id, limit: 6 });
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.error, outOfCredits: guard.outOfCredits, upgradeUrl: guard.upgradeUrl },
        { status: guard.status },
      );
    }

    const headline =
      stripEmDashes(String(form.get("headline") ?? "").trim()) ||
      currentCopy?.headline ||
      draftCtx.content.subject;
    if (!headline) {
      return NextResponse.json(
        { error: "The flyer needs a headline." },
        { status: 400 },
      );
    }
    const readOptional = (field: string, fallback?: string) => {
      // An absent field keeps the stored value; an explicitly blank one clears it.
      const raw = form.get(field);
      if (raw === null) return fallback;
      const value = stripEmDashes(String(raw).trim());
      return value || undefined;
    };
    const subtext = readOptional("subtext", currentCopy?.subtext);
    const cta = readOptional("cta", currentCopy?.cta);
    const scene =
      readOptional("scene", meta.flyer_scene) ??
      "a clean, minimal brand-colored background composition with soft depth";

    const referenceFile = form.get("reference");
    let reference: { data: string; mimeType: string } | undefined;
    if (referenceFile instanceof File && referenceFile.size > 0) {
      if (!referenceFile.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Only image files work as a reference." },
          { status: 400 },
        );
      }
      if (referenceFile.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "That reference is over 10MB. Use a smaller file." },
          { status: 400 },
        );
      }
      reference = await prepareReferenceImage(
        Buffer.from(await referenceFile.arrayBuffer()),
      );
    }
    // "none" clears the saved style; absent keeps the draft's current one.
    const rawStyleId = form.get("styleReferenceId") as string | null;
    const styleReferenceId =
      rawStyleId === "none"
        ? undefined
        : rawStyleId?.trim() || meta.style_reference_id;

    const exactPrompt =
      (form.get("exactPrompt") as string | null)?.trim().slice(0, 2000) || undefined;

    const copyForRender = { headline, subtext, cta, caption: currentCopy?.caption ?? "", hashtags: currentCopy?.hashtags, scene };
    const { image, usage } = await regenerateFlyerImage({
      ctx,
      copy: copyForRender,
      aspect,
      styleReferenceId,
      style: meta.flyer_style,
      reference,
      exactPrompt,
      draftId: id,
    });

    let rolled = meta.usage;
    for (const delta of usage as UsageDelta[]) rolled = accumulateUsage(rolled, delta);

    const flyerCopy: FlyerCopy = {
      headline,
      ...(subtext ? { subtext } : {}),
      ...(cta ? { cta } : {}),
      caption: currentCopy?.caption ?? "",
      ...(currentCopy?.hashtags?.length ? { hashtags: currentCopy.hashtags } : {}),
    };

    await updateDraftContent(
      id,
      { ...draftCtx.content, subject: headline },
      {
        ...meta,
        flyer_copy: flyerCopy,
        flyer_image: image,
        flyer_aspect: aspect,
        flyer_scene: scene,
        style_reference_id: styleReferenceId,
        usage: rolled,
      },
    );
    return NextResponse.json({ image, copy: flyerCopy, aspect });
  } catch (err) {
    logError("api:/api/drafts/[id]/flyer:post", err);
    const message =
      err instanceof Error ? err.message : "Couldn't update the flyer. Try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function readAspect(form: FormData, current?: FlyerAspect): FlyerAspect {
  const raw = form.get("aspect");
  if (isFlyerAspect(raw)) return raw;
  return current ?? DEFAULT_FLYER_ASPECT;
}
