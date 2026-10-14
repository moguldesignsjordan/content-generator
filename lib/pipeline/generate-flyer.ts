import "server-only";
import {
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
import { isGeminiConfigured } from "@/lib/clients/gemini-image";
import { renderImage, resolveImageModel } from "@/lib/clients/image-render";
import {
  createMediaAsset,
  getDraftWithJobContext,
  getEmailCopyForDraft,
  getLatestDraftVersion,
  getCompetitorReference,
  getDefaultDesignLook,
  getDesignLook,
  getStyleReference,
  getTopicContext,
  patchDraftGeneration,
  persistRegeneratedDraft,
  populateDraft,
  rejectDraftRecord,
} from "@/lib/db/queries";
import { optimizeFlyerImage, prepareReferenceImage } from "@/lib/images/optimize";
import { uploadContentImage } from "./generate-image";
import sharp from "sharp";
import { composeFlyer, stampLogo } from "@/lib/flyer/compose";
import { mapBrandColors } from "@/lib/flyer/color-roles";
import { checkRenderedText } from "@/lib/flyer/text-check";
import { loadLookImages } from "./extract-look";
import { readImageText } from "./read-image-text";
import { pickLayout, quietZoneFor } from "@/lib/flyer/layout";
import { resolveBrandTokens } from "@/lib/email/templates/types";
import { buildBrandVoiceBlock, buildGuidelinesBlock } from "@/prompts/brand-voice";
import {
  DEFAULT_FLYER_ASPECT,
  FLYER_ASPECTS,
  FLYER_VARIANT_COUNT,
  flyerVariantsTool,
  buildFlyerCopyMessages,
  buildFlyerDesignPrompt,
  buildFlyerImagePrompt,
  parseFlyerVariants,
  resolveVariantStyles,
  type FlyerCopyOutput,
} from "@/prompts/generate-flyer";
import { stripEmDashes } from "@/lib/text";
import type {
  CompetitorReference,
  ContentImage,
  DesignLookProfile,
  DraftMeta,
  DraftUsage,
  EmailCopy,
  FlyerAspect,
  FlyerCopy,
  FlyerFormat,
  FlyerLayout,
  FlyerStyleId,
  FlyerVariant,
  ImageModelTier,
  TopicContext,
} from "@/lib/db/types";
import { MAX_DRAFT_VERSIONS } from "./constants";
import { accumulateUsage, type UsageDelta } from "./cost";
import type { GenerationEvent } from "./generate";
import { logError, logImageUsage, logWarn } from "@/lib/log";

// Social flyer generation (content_jobs.type='social'): one FAST_MODEL call
// writes FLYER_VARIANT_COUNT alternative flyers (copy + scene, each fitted to
// its own design direction), Gemini renders each one's text-free artwork in
// parallel (built around the real product photo when there is one), code sets
// the text and logo on top in the brand's fonts (lib/flyer/compose.tsx), sharp
// fits them to the exact post shape, and they're hosted on content-images.
// The reviewer picks one and can re-render just that one on the pro tier. The
// human approval gate covers the output like every other draft kind.

/**
 * Fills in a flyer draft shell, mirroring generateBlogForTopicStreamed's
 * phase → done/error contract so the SSE route and progress UI work
 * unchanged. Inputs beyond the topic (aspect, brief, style reference, source
 * email) travel on the shell's meta, written by createDraftShell.
 */
export async function generateFlyerForTopicStreamed(
  draftId: string,
  ctx: TopicContext,
  _opts: { campaignId?: string },
  onEvent: (event: GenerationEvent) => void,
): Promise<void> {
  try {
    if (!isGeminiConfigured()) {
      throw new Error(
        "Image generation isn't set up yet: add GEMINI_API_KEY to .env.local.",
      );
    }

    // The shell's meta carries the creation-time inputs.
    const draftCtx = await getDraftWithJobContext(draftId);
    if (!draftCtx) throw new Error(`Draft ${draftId} not found`);
    const meta = draftCtx.meta;
    const aspect: FlyerAspect = meta.flyer_aspect ?? DEFAULT_FLYER_ASPECT;
    // Explicit preset → every option uses it; uploaded reference → no preset
    // (the reference IS the style); neither → a distinct look per option.
    const styles = resolveVariantStyles(draftId, {
      fixedStyle: meta.flyer_style,
      hasReference: Boolean(meta.style_reference_id),
    });

    const writing = { phase: "writing", label: "Writing flyer copy" };
    await patchDraftGeneration(draftId, writing);
    onEvent({ type: "phase", ...writing });

    // Spun off an email? Distill that email's offer instead of re-briefing.
    let emailCopy: EmailCopy | null = null;
    if (meta.source_draft_id) {
      emailCopy = await getEmailCopyForDraft(meta.source_draft_id).catch((err) => {
        logWarn(
          "pipeline:generate-flyer:source-email",
          err instanceof Error ? err.message : String(err),
          { draftId },
        );
        return null;
      });
    }

    const competitorRef = await loadCompetitorRef(
      meta.competitor_reference_id,
      ctx.brand.id,
      draftId,
    );

    const look = await resolveLook(meta.look_id, ctx.brand.id, draftId);

    const usageDeltas: UsageDelta[] = [];
    const copies = await generateFlyerVariants(ctx, {
      aspect,
      brief: withLookNote(meta.flyer_brief, look?.profile),
      style: meta.flyer_style,
      styles,
      emailCopy,
      competitorRef,
      format: meta.flyer_format ?? "post",
      usageDeltas,
    });

    const rendering = {
      phase: "image",
      label: `Designing ${copies.length} flyer options`,
    };
    await patchDraftGeneration(draftId, rendering);
    onEvent({ type: "phase", ...rendering });

    const variants = await renderFlyerVariants(ctx, copies, styles, {
      aspect,
      styleReferenceId: meta.style_reference_id,
      productPhoto: await loadProductPhoto(
        meta.product_photo_url ?? ctx.product?.image_url ?? undefined,
        draftId,
      ),
      draftId,
      usageDeltas,
      modelTier: meta.flyer_model,
      look,
    });
    const first = variants[0];

    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const nextMeta: DraftMeta = {
      ...mirrorVariant(first),
      ...(look ? { look_id: look.id } : {}),
      flyer_aspect: aspect,
      flyer_variants: variants,
      flyer_variant_index: 0,
      usage,
    };

    await populateDraft(draftId, {
      // The EmailDraftContent shape keeps every list/approve/state code path
      // working; html stays empty because a flyer has no HTML body.
      content: {
        subject: first.copy.headline,
        preheader: first.copy.caption.slice(0, 120),
        html: "",
      },
      meta: nextMeta,
    });

    onEvent({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    await patchDraftGeneration(draftId, { status: "error", error: message }).catch(
      (e) => logError("pipeline:generate-flyer:record-error-phase", e, { draftId }),
    );
    onEvent({ type: "error", message });
    throw err;
  }
}

/**
 * Rejects the current flyer draft and regenerates a new version with the
 * reviewer's feedback woven into the copy call, mirroring regenerateBlogDraft
 * (same version cap, same in_review guard, same reject-before-generate
 * ordering). The new version re-renders the image too, since a flyer's copy
 * IS its image.
 */
export async function regenerateFlyerDraft(
  draftId: string,
  feedback: string,
): Promise<{ newDraftId: string } | { capped: true } | { notInReview: true }> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) throw new Error(`Draft ${draftId} not found`);

  if (draftCtx.state !== "in_review") return { notInReview: true };

  const latestVersion = await getLatestDraftVersion(draftCtx.jobId);
  if (latestVersion >= MAX_DRAFT_VERSIONS) return { capped: true };

  await rejectDraftRecord(draftId, feedback);

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) throw new Error(`Topic not found for draft ${draftId}`);

  const meta = draftCtx.meta;
  const aspect: FlyerAspect = meta.flyer_aspect ?? DEFAULT_FLYER_ASPECT;

  let emailCopy: EmailCopy | null = null;
  if (meta.source_draft_id) {
    emailCopy = await getEmailCopyForDraft(meta.source_draft_id).catch(() => null);
  }

  // flyer_style now holds whichever option was picked, so it only means "the
  // user chose this preset" when every option shared it (or on a draft from
  // before variants existed, where it was always the resolved preset).
  const priorStyles = meta.flyer_variants?.map((v) => v.style);
  const fixedStyle = priorStyles
    ? new Set(priorStyles).size === 1
      ? priorStyles[0]
      : undefined
    : meta.flyer_style;
  // Seeded by the next version so a rejection re-rolls the looks too.
  const styles = resolveVariantStyles(`${draftId}:${latestVersion + 1}`, {
    fixedStyle,
    hasReference: Boolean(meta.style_reference_id),
  });

  const competitorRef = await loadCompetitorRef(
    meta.competitor_reference_id,
    ctx.brand.id,
    draftId,
  );

  const look = await resolveLook(meta.look_id, ctx.brand.id, draftId);

  const usageDeltas: UsageDelta[] = [];
  const copies = await generateFlyerVariants(ctx, {
    aspect,
    brief: withLookNote(meta.flyer_brief, look?.profile),
    style: fixedStyle,
    styles,
    emailCopy,
    competitorRef,
    format: meta.flyer_format ?? "post",
    usageDeltas,
    rejection: {
      feedback,
      previousHeadline: meta.flyer_copy?.headline ?? draftCtx.content.subject,
      previousCaption: meta.flyer_copy?.caption,
    },
  });

  const variants = await renderFlyerVariants(ctx, copies, styles, {
    aspect,
    styleReferenceId: meta.style_reference_id,
    productPhoto: await loadProductPhoto(
      meta.product_photo_url ?? ctx.product?.image_url ?? undefined,
      draftId,
    ),
    draftId,
    usageDeltas,
    modelTier: meta.flyer_model,
    look,
  });
  const first = variants[0];

  let usage: DraftUsage | undefined;
  for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

  const newDraftId = await persistRegeneratedDraft({
    jobId: draftCtx.jobId,
    version: latestVersion + 1,
    content: {
      subject: first.copy.headline,
      preheader: first.copy.caption.slice(0, 120),
      html: "",
    },
    meta: {
      ...mirrorVariant(first),
      flyer_aspect: aspect,
      flyer_variants: variants,
      flyer_variant_index: 0,
      ...(meta.flyer_brief ? { flyer_brief: meta.flyer_brief } : {}),
      ...(meta.style_reference_id
        ? { style_reference_id: meta.style_reference_id }
        : {}),
      ...(meta.competitor_reference_id
        ? { competitor_reference_id: meta.competitor_reference_id }
        : {}),
      ...(meta.flyer_format ? { flyer_format: meta.flyer_format } : {}),
      ...(meta.source_draft_id ? { source_draft_id: meta.source_draft_id } : {}),
      // A rejected scheduled post keeps its day in the weekly queue.
      ...(meta.planned_publish_at ? { planned_publish_at: meta.planned_publish_at } : {}),
      ...(meta.product_photo_url ? { product_photo_url: meta.product_photo_url } : {}),
      ...(meta.flyer_model ? { flyer_model: meta.flyer_model } : {}),
      ...(look ? { look_id: look.id } : {}),
      usage,
    },
  });

  return { newDraftId };
}

/**
 * The image-only edit path for the review sheet: re-renders the flyer from
 * the current (possibly user-edited) copy at a chosen aspect/style, or from a
 * full exact prompt (the tweak-and-regenerate path, zero Claude tokens either
 * way). Returns the new image; the route persists it.
 */
export async function regenerateFlyerImage(args: {
  ctx: TopicContext;
  copy: FlyerCopyOutput;
  aspect: FlyerAspect;
  styleReferenceId?: string;
  /** The draft's persisted design-direction preset (meta.flyer_style), so an
   * image-only re-render keeps the same look. Ignored when a reference or
   * exact prompt is in play. */
  style?: FlyerStyleId;
  /** One-off reference attached in the sheet; wins over styleReferenceId. */
  reference?: { data: string; mimeType: string };
  /** Full final prompt override, sent verbatim (plus the style directive
   * when a reference is present). */
  exactPrompt?: string;
  /** Concrete image model id; defaults to the brand's tier. The "Finalize in
   * Pro" action passes the pro model. */
  model?: string;
  /** The picked option's text layout (meta.flyer_layout), kept on re-render. */
  layout?: FlyerLayout;
  /** meta.product_photo_url; falls back to the topic's product photo. */
  productPhotoUrl?: string;
  /** meta.look_id: re-render following the same look (AI-designed). */
  lookId?: string;
  draftId: string;
}): Promise<{ image: ContentImage; usage: UsageDelta[] }> {
  if (!isGeminiConfigured()) {
    throw new Error(
      "Image generation isn't set up yet: add GEMINI_API_KEY to .env.local.",
    );
  }
  const usageDeltas: UsageDelta[] = [];

  const reference =
    args.reference ??
    (await loadStyleReference(args.styleReferenceId, args.draftId)) ??
    undefined;
  const tokens = resolveBrandTokens(args.ctx.brand);
  const layout = args.layout ?? pickLayout(0);

  // A flyer that follows a look re-renders as an AI design, text checked; the
  // code-set path below is its fallback, and the exact-prompt path stays the
  // user's full control.
  if (!args.exactPrompt && args.lookId) {
    const look = await resolveLook(args.lookId, args.ctx.brand.id, args.draftId);
    if (look) {
      const designed = await renderDesignedFlyer(args.ctx, args.copy, {
        aspect: args.aspect,
        look,
        model: args.model ?? resolveImageModel(args.ctx.brand.visual_identity?.image_gen?.model),
        productPhoto: await loadProductPhoto(
          args.productPhotoUrl ?? args.ctx.product?.image_url ?? undefined,
          args.draftId,
        ),
        draftId: args.draftId,
        usageDeltas,
      });
      if (designed) return { image: designed, usage: usageDeltas };
    }
  }

  // The exact-prompt path is the user's full control: the model draws
  // whatever the prompt says, text included, and nothing is composed on top.
  // Every other path draws text-free art and composes the text in code.
  const productPhoto = args.exactPrompt
    ? null
    : await loadProductPhoto(
        args.productPhotoUrl ?? args.ctx.product?.image_url ?? undefined,
        args.draftId,
      );
  const finalPrompt = args.exactPrompt
    ? reference
      ? `${args.exactPrompt} A reference image is attached: match its visual style, layout language, color treatment, and mood, but keep the text content exactly as specified above.`
      : args.exactPrompt
    : buildFlyerImagePrompt(args.copy, tokens, args.aspect, Boolean(reference), args.style, {
        hasProduct: Boolean(productPhoto),
        quietZone: quietZoneFor(layout),
      });

  const rendered = await renderImage({
    model:
      args.model ?? resolveImageModel(args.ctx.brand.visual_identity?.image_gen?.model),
    prompt: finalPrompt,
    aspectRatio: args.aspect,
    references: [...(productPhoto ? [productPhoto] : []), ...(reference ? [reference] : [])],
    minSize: "2K",
  });
  const imageModel = rendered.billedModel;
  usageDeltas.push({ model: imageModel, images: 1 });
  logImageUsage("flyer-image-regenerate", imageModel, 1, {
    brandId: args.ctx.brand.id,
    draftId: args.draftId,
    metered: true,
  });

  const size = FLYER_ASPECTS[args.aspect];
  const finished = args.exactPrompt
    ? rendered.data
    : await composeFlyer({
        art: rendered.data,
        text: { headline: args.copy.headline, subtext: args.copy.subtext, cta: args.copy.cta },
        tokens,
        width: size.width,
        height: size.height,
        layout,
      });
  const optimized = await optimizeFlyerImage(finished, size);
  const { url, path } = await uploadContentImage(optimized.data);
  const alt = stripEmDashes(args.copy.headline).slice(0, 160);

  recordFlyerMediaAsset({
    brandId: args.ctx.brand.id,
    url,
    storagePath: path,
    alt,
    prompt: finalPrompt,
    width: optimized.width,
    height: optimized.height,
    draftId: args.draftId,
  });

  return {
    image: {
      url,
      alt,
      width: optimized.width,
      height: optimized.height,
      style: "illustration",
      prompt: finalPrompt,
    },
    usage: usageDeltas,
  };
}

/**
 * The shared render path: style reference → brand tokens → final prompt →
 * Gemini → sharp fit to the exact post shape → hosted URL.
 */
async function renderFlyer(
  ctx: TopicContext,
  copy: FlyerCopyOutput,
  opts: {
    aspect: FlyerAspect;
    styleReferenceId?: string;
    style?: FlyerStyleId;
    draftId: string;
    usageDeltas: UsageDelta[];
    /** Concrete image model id; defaults to the brand's tier. */
    model?: string;
    layout: FlyerLayout;
    productPhoto?: { data: string; mimeType: string } | null;
  },
): Promise<ContentImage> {
  const reference = await loadStyleReference(opts.styleReferenceId, opts.draftId);
  const tokens = resolveBrandTokens(ctx.brand);
  const finalPrompt = buildFlyerImagePrompt(
    copy,
    tokens,
    opts.aspect,
    Boolean(reference),
    opts.style,
    { hasProduct: Boolean(opts.productPhoto), quietZone: quietZoneFor(opts.layout) },
  );

  const rendered = await renderImage({
    model: opts.model ?? resolveImageModel(ctx.brand.visual_identity?.image_gen?.model),
    prompt: finalPrompt,
    aspectRatio: opts.aspect,
    // Product first, then style: the prompt names them in that order.
    references: [
      ...(opts.productPhoto ? [opts.productPhoto] : []),
      ...(reference ? [reference] : []),
    ],
    // 1080x1350 posts come out soft from a 1K render.
    minSize: "2K",
  });
  const imageModel = rendered.billedModel;
  opts.usageDeltas.push({ model: imageModel, images: 1 });
  logImageUsage("flyer-image", imageModel, 1, {
    brandId: ctx.brand.id,
    draftId: opts.draftId,
    metered: true,
  });

  const size = FLYER_ASPECTS[opts.aspect];
  const composed = await composeFlyer({
    art: rendered.data,
    text: { headline: copy.headline, subtext: copy.subtext, cta: copy.cta },
    tokens,
    width: size.width,
    height: size.height,
    layout: opts.layout,
  });
  const optimized = await optimizeFlyerImage(composed, size);
  const { url, path } = await uploadContentImage(optimized.data);
  const alt = stripEmDashes(copy.headline).slice(0, 160);

  recordFlyerMediaAsset({
    brandId: ctx.brand.id,
    url,
    storagePath: path,
    alt,
    prompt: finalPrompt,
    width: optimized.width,
    height: optimized.height,
    draftId: opts.draftId,
  });

  return {
    url,
    alt,
    width: optimized.width,
    height: optimized.height,
    style: "illustration",
    prompt: finalPrompt,
  };
}

/**
 * Renders every option in parallel, each with its own text layout, on the
 * model picked when the flyer was made (meta.flyer_model), else the brand's
 * default, else Nano Banana 2.1. Finalizing re-renders only the picked one. A failed render
 * just means one fewer option; only all of them failing is an error. Usage is
 * recorded per successful render, so a failure isn't billed.
 */
async function renderFlyerVariants(
  ctx: TopicContext,
  copies: FlyerCopyOutput[],
  styles: (FlyerStyleId | undefined)[],
  opts: {
    aspect: FlyerAspect;
    styleReferenceId?: string;
    productPhoto?: { data: string; mimeType: string } | null;
    draftId: string;
    usageDeltas: UsageDelta[];
    modelTier?: ImageModelTier;
    /** With a look, each option is AI-designed to follow it, falling back to
     * the code-set layout only if its text can't be verified. */
    look?: ResolvedLook | null;
  },
): Promise<FlyerVariant[]> {
  const model = resolveImageModel(
    opts.modelTier ?? ctx.brand.visual_identity?.image_gen?.model,
  );
  const results = await Promise.allSettled(
    copies.map(async (copy, i) => {
      if (opts.look) {
        const designed = await renderDesignedFlyer(ctx, copy, { ...opts, look: opts.look, model });
        if (designed) return { image: designed, layout: undefined };
      }
      const layout = pickLayout(i);
      const image = await renderFlyer(ctx, copy, { ...opts, style: styles[i], model, layout });
      return { image, layout };
    }),
  );

  const variants: FlyerVariant[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      logError("pipeline:generate-flyer:variant-render", result.reason, {
        draftId: opts.draftId,
      });
      return;
    }
    variants.push({
      ...(styles[i] ? { style: styles[i] } : {}),
      copy: toFlyerCopy(copies[i]),
      scene: copies[i].scene,
      image: result.value.image,
      ...(result.value.layout ? { layout: result.value.layout } : {}),
    });
  });

  if (variants.length === 0) {
    const firstFailure = results.find((r) => r.status === "rejected");
    throw firstFailure?.status === "rejected" && firstFailure.reason instanceof Error
      ? firstFailure.reason
      : new Error("Couldn't render the flyer. Try again.");
  }
  return variants;
}

/** The meta fields approve, download and the drafts list read, from one option. */
function mirrorVariant(variant: FlyerVariant): Partial<DraftMeta> {
  return {
    flyer_copy: variant.copy,
    flyer_image: variant.image,
    flyer_scene: variant.scene,
    ...(variant.style ? { flyer_style: variant.style } : {}),
    ...(variant.layout ? { flyer_layout: variant.layout } : {}),
  };
}

/** Records a flyer render in the media library. Fire-and-forget: a logging
 * failure must never break the flyer render it's attached to. */
function recordFlyerMediaAsset(args: {
  brandId: string;
  url: string;
  storagePath: string;
  alt: string;
  prompt: string;
  width: number;
  height: number;
  draftId: string;
}): void {
  createMediaAsset({
    brandId: args.brandId,
    url: args.url,
    storagePath: args.storagePath,
    alt: args.alt,
    kind: "flyer",
    source: "generated",
    style: "illustration",
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    originDraftId: args.draftId,
  }).catch((err) => {
    logError("pipeline:generate-flyer:record-media-asset", err);
  });
}

/** Strips the scene field, leaving what drafts.meta.flyer_copy stores. */
function toFlyerCopy(copy: FlyerCopyOutput): FlyerCopy {
  return {
    headline: copy.headline,
    ...(copy.subtext ? { subtext: copy.subtext } : {}),
    ...(copy.cta ? { cta: copy.cta } : {}),
    caption: copy.caption,
    ...(copy.hashtags?.length ? { hashtags: copy.hashtags } : {}),
    ...(copy.ad ? { ad: copy.ad } : {}),
  };
}

/**
 * The copy + scene call for every option at once: forced tool use with one
 * retry, the same reliability pattern as generateBlogCopy. One call instead of
 * one per option: the brand voice/guidelines input is the bulk of the tokens,
 * and this way it's paid once.
 */
/**
 * The competitor ad a flyer learns from, or null. Scoped to the draft's own
 * brand, since the id arrives from the client. Non-fatal: a missing or
 * foreign ref just means a flyer without one.
 */
async function loadCompetitorRef(
  id: string | undefined,
  brandId: string,
  draftId: string,
): Promise<CompetitorReference | null> {
  if (!id) return null;
  try {
    const ref = await getCompetitorReference(id);
    return ref?.brand_id === brandId ? ref : null;
  } catch (err) {
    logWarn("pipeline:generate-flyer:competitor-ref", String(err), { draftId, id });
    return null;
  }
}

async function generateFlyerVariants(
  ctx: TopicContext,
  opts: {
    aspect: FlyerAspect;
    brief?: string;
    /** A preset every option shares, when the user picked one. */
    style?: FlyerStyleId;
    /** One entry per option to generate, by position. */
    styles: (FlyerStyleId | undefined)[];
    emailCopy: EmailCopy | null;
    competitorRef: CompetitorReference | null;
    format: FlyerFormat;
    usageDeltas: UsageDelta[];
    rejection?: {
      feedback: string;
      previousHeadline?: string;
      previousCaption?: string;
    };
  },
): Promise<FlyerCopyOutput[]> {
  const count = opts.styles.length || FLYER_VARIANT_COUNT;
  const { system, user } = buildFlyerCopyMessages({
    brandName: ctx.brand.name,
    voiceBlock: buildBrandVoiceBlock(ctx.brand, ctx.primaryIcp, "social"),
    guidelinesBlock: buildGuidelinesBlock(ctx.brand) || undefined,
    topicTitle: ctx.topic.title,
    aspect: opts.aspect,
    brief: opts.brief,
    style: opts.style,
    emailCopy: opts.emailCopy ?? undefined,
    competitorRef: opts.competitorRef,
    format: opts.format,
    rejection: opts.rejection,
    variants: { count, styles: opts.styles },
  });

  const call = async (label: string): Promise<FlyerCopyOutput[]> => {
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 4096,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [flyerVariantsTool(opts.format)],
      tool_choice: { type: "tool", name: "save_flyer_variants" },
    });
    logUsage(label, FAST_MODEL, response.usage, {
      brandId: ctx.brand.id,
      metered: true,
      requestId: response.id,
    });
    opts.usageDeltas.push({ model: FAST_MODEL, ...response.usage });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_flyer_variants",
    );
    const variants =
      tu && tu.type === "tool_use" ? parseFlyerVariants(tu.input, count, opts.format) : [];
    if (variants.length === 0) {
      throw new Error("Couldn't come up with flyer copy. Try again.");
    }
    return variants;
  };

  try {
    return await call("flyer-copy");
  } catch (err) {
    logError("pipeline:generate-flyer:copy", err);
    return await call("flyer-copy-retry");
  }
}

/** A look ready to render with: its profile and up to 3 example images. */
interface ResolvedLook {
  id: string;
  profile: DesignLookProfile | null;
  images: { data: string; mimeType: string }[];
}

/** Examples sent per render: with the product photo that's 4 references,
 * inside every image model's limit. */
const LOOK_EXAMPLES_PER_RENDER = 3;

/**
 * The look a flyer follows: its own (meta.look_id), else the brand's default
 * ("none" opts out of the default).
 * Non-fatal: a deleted look, a pre-031 DB, or unreadable examples all mean
 * "no look", and the flyer renders the code-set way.
 */
async function resolveLook(
  lookId: string | undefined,
  brandId: string,
  draftId: string,
): Promise<ResolvedLook | null> {
  // "none": the owner picked the code-set layouts over the brand default.
  if (lookId === "none") return null;
  try {
    const look = lookId
      ? await getDesignLook(lookId, brandId)
      : await getDefaultDesignLook(brandId);
    if (!look?.examples.length) return null;
    const images = await loadLookImages(look.examples, LOOK_EXAMPLES_PER_RENDER);
    if (!images.length) return null;
    return { id: look.id, profile: look.profile, images };
  } catch (err) {
    logWarn("pipeline:generate-flyer:look", err instanceof Error ? err.message : String(err), {
      draftId,
    });
    return null;
  }
}

/** Tells the copy writer how much text the look carries, so a minimal look
 * gets a short headline instead of a paragraph squeezed into the design. */
function withLookNote(brief: string | undefined, profile: DesignLookProfile | null | undefined): string | undefined {
  if (!profile) return brief;
  const length =
    profile.text_amount === "minimal"
      ? "Keep the headline very short (a few words) and the supporting line optional."
      : profile.text_amount === "heavy"
        ? "The look carries more text: a headline plus a fuller supporting line is fine."
        : "A short headline and one supporting line.";
  return [brief, `DESIGN LOOK this flyer follows: ${profile.summary} ${length}`].filter(Boolean).join("\n");
}

/** Read-back attempts per option before falling back to the code-set layout. */
const DESIGN_ATTEMPTS = 2;

/**
 * Renders one option as a full AI design that follows the look, then reads
 * the text back. Returns null when the text can't be verified after
 * DESIGN_ATTEMPTS, and the caller uses the code-set layout instead, so a
 * misspelled flyer is never shown. Each render is billed whether or not it
 * passes, since it was made.
 */
async function renderDesignedFlyer(
  ctx: TopicContext,
  copy: FlyerCopyOutput,
  opts: {
    aspect: FlyerAspect;
    look: ResolvedLook;
    model: string;
    productPhoto?: { data: string; mimeType: string } | null;
    draftId: string;
    usageDeltas: UsageDelta[];
  },
): Promise<ContentImage | null> {
  const tokens = resolveBrandTokens(ctx.brand);
  const profile = opts.look.profile;
  const roles = mapBrandColors(tokens.colors, profile?.color_roles.background ?? "photo");
  const references = [
    ...(opts.productPhoto ? [opts.productPhoto] : []),
    ...opts.look.images,
  ];
  const expected = [
    copy.headline,
    copy.subtext ?? "",
    copy.cta && profile?.cta_style !== "none" ? copy.cta : "",
  ].filter(Boolean);
  const size = FLYER_ASPECTS[opts.aspect];

  // The logo is stamped wherever the look puts it (top-left when unknown), so
  // the prompt keeps exactly that corner clear.
  const corner = profile?.logo_placement === "none" ? null : (profile?.logo_placement ?? "top-left");
  let misspelled: string[] | undefined;
  for (let attempt = 0; attempt < DESIGN_ATTEMPTS; attempt++) {
    const prompt = buildFlyerDesignPrompt(
      copy,
      tokens,
      opts.aspect,
      { profile, exampleCount: opts.look.images.length, roles },
      { hasProduct: Boolean(opts.productPhoto), misspelled, logoCorner: corner },
    );
    const rendered = await renderImage({
      model: opts.model,
      prompt,
      aspectRatio: opts.aspect,
      references,
      minSize: "2K",
    });
    opts.usageDeltas.push({ model: rendered.billedModel, images: 1 });
    logImageUsage("flyer-design", rendered.billedModel, 1, {
      brandId: ctx.brand.id,
      draftId: opts.draftId,
      metered: true,
    });

    const preview = await sharp(rendered.data)
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const seen = await readImageText(preview, {
      brandId: ctx.brand.id,
      draftId: opts.draftId,
      usageDeltas: opts.usageDeltas,
    });
    if (seen === null) break; // Can't verify: use the safe layout.
    const check = checkRenderedText(expected, seen);
    if (!check.ok) {
      logWarn("pipeline:generate-flyer:text-check", "designed flyer text didn't match", {
        draftId: opts.draftId,
        missing: check.missing,
        extra: check.extra.slice(0, 12),
      });
      misspelled = check.missing.length ? check.missing : undefined;
      continue;
    }

    const finished =
      corner === null
        ? rendered.data
        : await stampLogo({ image: rendered.data, tokens, width: size.width, height: size.height, corner });
    const optimized = await optimizeFlyerImage(finished, size);
    const { url, path } = await uploadContentImage(optimized.data);
    const alt = stripEmDashes(copy.headline).slice(0, 160);
    recordFlyerMediaAsset({
      brandId: ctx.brand.id,
      url,
      storagePath: path,
      alt,
      prompt,
      width: optimized.width,
      height: optimized.height,
      draftId: opts.draftId,
    });
    return { url, alt, width: optimized.width, height: optimized.height, style: "illustration", prompt };
  }
  return null;
}

/**
 * The real product photo the art is built around, as Gemini's reference
 * payload. Non-fatal like loadStyleReference: an unreachable photo logs a
 * warning and the flyer renders without it.
 */
async function loadProductPhoto(
  url: string | undefined,
  draftId: string,
): Promise<{ data: string; mimeType: string } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return await prepareReferenceImage(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    logWarn(
      "pipeline:generate-flyer:product-photo",
      err instanceof Error ? err.message : String(err),
      { draftId },
    );
    return null;
  }
}

/**
 * Resolves a style_references row into the base64 reference payload Gemini
 * takes. Non-fatal by design: a deleted style or an unreachable image logs a
 * warning and the flyer renders without style transfer.
 */
async function loadStyleReference(
  styleReferenceId: string | undefined,
  draftId: string,
): Promise<{ data: string; mimeType: string } | null> {
  if (!styleReferenceId) return null;
  try {
    const ref = await getStyleReference(styleReferenceId);
    if (!ref) {
      logWarn("pipeline:generate-flyer:style-ref", "style reference not found", {
        draftId,
      });
      return null;
    }
    const res = await fetch(ref.image_url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return await prepareReferenceImage(buffer);
  } catch (err) {
    logWarn(
      "pipeline:generate-flyer:style-ref",
      err instanceof Error ? err.message : String(err),
      { draftId },
    );
    return null;
  }
}
