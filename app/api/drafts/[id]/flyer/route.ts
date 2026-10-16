import { NextRequest, NextResponse } from "next/server";
import {
  createMediaAsset,
  getBrandByDraftId,
  getTopicContext,
  updateDraftContent,
} from "@/lib/db/queries";
import { requireDraftInBrand } from "@/lib/draft-access";
import { accumulateUsage, type UsageDelta } from "@/lib/pipeline/cost";
import { placeImageInFlyer, regenerateFlyerImage } from "@/lib/pipeline/generate-flyer";
import { resolveImageModel } from "@/lib/clients/image-render";
import { isImageModelTier } from "@/lib/image-models";
import { uploadContentImage } from "@/lib/pipeline/generate-image";
import { optimizeFlyerImage, prepareReferenceImage } from "@/lib/images/optimize";
import {
  DEFAULT_FLYER_ASPECT,
  FLYER_ASPECTS,
  cleanAdCopy,
  isFlyerAspect,
} from "@/prompts/generate-flyer";
import { stripEmDashes } from "@/lib/text";
import { inputsOf } from "@/lib/inputs";
import type { ContentImage, DraftMeta, FlyerAspect, FlyerCopy } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { guardAiRoute } from "@/lib/ai-guard";

// A Gemini render + optimize + upload usually lands in 10-25s; headroom for
// retries and cold buckets, same as the hero-image route.
export const maxDuration = 240;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
// The edit sheet pre-fills the full prompt a design was made with (about 4,000
// chars for a designed flyer); a cut-off one loses its colors and text.
const MAX_EXACT_PROMPT_CHARS = 8000;

/**
 * POST multipart/form-data — edits to a social flyer draft. Modes:
 *  - "generate" (default): re-renders the design. { headline?, subtext?,
 *    cta?, scene?, aspect?, styleReferenceId?, reference?, exactPrompt? }.
 *    referenceRole "place" (+ referenceNote) edits the current design to
 *    include the reference instead of copying its style.
 *    Copy fields default to the stored flyer_copy; exactPrompt sends the full
 *    prompt verbatim (the tweak-and-regenerate path). Zero Claude tokens
 *    either way, one image render. { tier } (any image model choice) is
 *    "Finalize": the current option re-rendered on that model, upgrading it
 *    in place.
 *  - "upload": { file } replaces the design with the user's own image,
 *    cover-fitted to the flyer's post shape. No AI.
 *  - "caption": { caption, hashtags? } edits the post caption only. No AI,
 *    no image change.
 *  - "ad_copy": { primary_text, headline, description?, cta_button } edits an
 *    ad-format flyer's text fields (caption mirrors primary_text). No AI.
 *  - "pick": { index } swaps in another already-rendered option from
 *    meta.flyer_variants. No AI.
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

    // ── caption / ad_copy: plain text edit, instant ────────────────────────
    if (mode === "caption" || mode === "ad_copy") {
      const baseCopy = {
        headline: currentCopy?.headline ?? draftCtx.content.subject,
        ...(currentCopy?.subtext ? { subtext: currentCopy.subtext } : {}),
        ...(currentCopy?.cta ? { cta: currentCopy.cta } : {}),
      };
      let flyerCopy: FlyerCopy;
      if (mode === "ad_copy") {
        const ad = cleanAdCopy({
          primary_text: String(form.get("primary_text") ?? ""),
          headline: String(form.get("headline") ?? ""),
          description: String(form.get("description") ?? ""),
          cta_button: String(form.get("cta_button") ?? ""),
        });
        if (!ad) {
          return NextResponse.json(
            { error: "The ad needs primary text and a headline." },
            { status: 400 },
          );
        }
        flyerCopy = { ...baseCopy, caption: ad.primary_text, ad };
      } else {
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
        flyerCopy = {
          ...baseCopy,
          caption,
          ...(hashtags.length ? { hashtags } : {}),
          ...(currentCopy?.ad ? { ad: currentCopy.ad } : {}),
        };
      }
      const caption = flyerCopy.caption;
      const variantIndex = meta.flyer_variant_index;
      await updateDraftContent(
        id,
        { ...draftCtx.content, preheader: caption.slice(0, 120) },
        {
          ...meta,
          flyer_copy: flyerCopy,
          // Keep the picked option in sync, so switching away and back
          // doesn't drop the caption edit.
          ...(variantIndex !== undefined && meta.flyer_variants
            ? {
                flyer_variants: meta.flyer_variants.map((v, i) =>
                  i === variantIndex ? { ...v, copy: flyerCopy } : v,
                ),
              }
            : {}),
        },
      );
      return NextResponse.json({ copy: flyerCopy });
    }

    // ── pick: swap in another option that's already rendered, free ─────────
    if (mode === "pick") {
      const index = Number(form.get("index"));
      const variant = Number.isInteger(index) ? meta.flyer_variants?.[index] : undefined;
      if (!variant) {
        return NextResponse.json({ error: "That option doesn't exist." }, { status: 400 });
      }
      await updateDraftContent(
        id,
        {
          ...draftCtx.content,
          subject: variant.copy.headline,
          preheader: variant.copy.caption.slice(0, 120),
        },
        {
          ...meta,
          flyer_copy: variant.copy,
          flyer_image: variant.image,
          flyer_scene: variant.scene,
          flyer_style: variant.style,
          flyer_layout: variant.layout,
          flyer_variant_index: index,
        },
      );
      return NextResponse.json({
        image: variant.image,
        copy: variant.copy,
        aspect: meta.flyer_aspect ?? DEFAULT_FLYER_ASPECT,
      });
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
        flyer_variant_index: undefined,
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
      (form.get("exactPrompt") as string | null)?.trim().slice(0, MAX_EXACT_PROMPT_CHARS) || undefined;
    const rawTier = form.get("tier");
    const finalizeTier = isImageModelTier(rawTier) ? rawTier : null;
    const finalize = finalizeTier !== null;
    // A plain model choice from the edit sheet: renders on that model without
    // the finalize-in-place upgrade.
    const rawModel = form.get("model");
    const renderTier = finalizeTier ?? (isImageModelTier(rawModel) ? rawModel : null);
    const variantIndex = meta.flyer_variant_index;
    const pickedPhotos =
      variantIndex !== undefined ? meta.flyer_variants?.[variantIndex]?.photos : undefined;

    const copyForRender = {
      headline,
      subtext,
      cta,
      caption: currentCopy?.caption ?? "",
      hashtags: currentCopy?.hashtags,
      ...(currentCopy?.extras?.length ? { extras: currentCopy.extras } : {}),
      scene,
    };
    // "place": the upload goes INTO the current design; otherwise it's a style.
    const placing = form.get("referenceRole") === "place";
    if (placing && (!reference || !meta.flyer_image?.url)) {
      return NextResponse.json(
        { error: reference ? "There's no design to add it to yet." : "Add the image to put in the design." },
        { status: 400 },
      );
    }
    const note = stripEmDashes(String(form.get("referenceNote") ?? "").trim()).slice(0, 300) || undefined;
    const { image, usage } = placing
      ? await placeImageInFlyer({
          ctx,
          copy: copyForRender,
          aspect,
          currentImageUrl: meta.flyer_image!.url,
          subject: reference!,
          note,
          ...(renderTier ? { model: resolveImageModel(renderTier) } : {}),
          ...(meta.client_brand ? { clientBrand: meta.client_brand } : {}),
          draftId: id,
        })
      : await regenerateFlyerImage({
      ctx,
      copy: copyForRender,
      aspect,
      styleReferenceId,
      style: meta.flyer_style,
      reference,
      exactPrompt,
      ...(renderTier ? { model: resolveImageModel(renderTier) } : {}),
      ...(meta.flyer_layout ? { layout: meta.flyer_layout } : {}),
      inputs: inputsOf(meta),
      ...(meta.look_id ? { cachedLookId: meta.look_id } : {}),
      ...(meta.reference_profile ? { referenceProfile: meta.reference_profile } : {}),
      // The picked option keeps the photos it was made with.
      ...(pickedPhotos ? { photoUrls: pickedPhotos } : {}),
      ...(meta.client_brand ? { clientBrand: meta.client_brand } : {}),
      ...(meta.flyer_variant_index !== undefined ? { variantIndex: meta.flyer_variant_index } : {}),
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
      ...(currentCopy?.ad ? { ad: currentCopy.ad } : {}),
      ...(currentCopy?.extras?.length ? { extras: currentCopy.extras } : {}),
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
        // Finalizing upgrades the picked option in place, so switching away
        // and back keeps the pro render. Any other re-render is a custom
        // design that matches none of the options.
        ...(finalize && variantIndex !== undefined && meta.flyer_variants
          ? {
              flyer_variants: meta.flyer_variants.map((v, i) =>
                i === variantIndex ? { ...v, image, finalized: true } : v,
              ),
            }
          : { flyer_variant_index: undefined }),
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
