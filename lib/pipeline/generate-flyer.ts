import "server-only";
import {
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
import {
  generateGeminiImage,
  isGeminiConfigured,
  resolveImageModel,
} from "@/lib/clients/gemini-image";
import {
  createMediaAsset,
  getDraftWithJobContext,
  getEmailCopyForDraft,
  getLatestDraftVersion,
  getStyleReference,
  getTopicContext,
  patchDraftGeneration,
  persistRegeneratedDraft,
  populateDraft,
  rejectDraftRecord,
} from "@/lib/db/queries";
import { optimizeFlyerImage, prepareReferenceImage } from "@/lib/images/optimize";
import { uploadContentImage } from "./generate-image";
import { resolveBrandTokens } from "@/lib/email/templates/types";
import { buildBrandVoiceBlock, buildGuidelinesBlock } from "@/prompts/brand-voice";
import {
  DEFAULT_FLYER_ASPECT,
  FLYER_ASPECTS,
  FLYER_VARIANT_COUNT,
  FLYER_VARIANTS_TOOL,
  buildFlyerCopyMessages,
  buildFlyerImagePrompt,
  parseFlyerVariants,
  resolveVariantStyles,
  type FlyerCopyOutput,
} from "@/prompts/generate-flyer";
import { stripEmDashes } from "@/lib/text";
import type {
  ContentImage,
  DraftMeta,
  DraftUsage,
  EmailCopy,
  FlyerAspect,
  FlyerCopy,
  FlyerStyleId,
  FlyerVariant,
  TopicContext,
} from "@/lib/db/types";
import { MAX_DRAFT_VERSIONS } from "./constants";
import { accumulateUsage, type UsageDelta } from "./cost";
import type { GenerationEvent } from "./generate";
import { logError, logImageUsage, logWarn } from "@/lib/log";

// Social flyer generation (content_jobs.type='social'): one FAST_MODEL call
// writes FLYER_VARIANT_COUNT alternative flyers (copy + scene, each fitted to
// its own design direction), Gemini renders each on the cheap preview tier in
// parallel (text typeset in the image), sharp fits them to the exact post
// shape, and they're hosted next to hero images on the content-images bucket.
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

    const usageDeltas: UsageDelta[] = [];
    const copies = await generateFlyerVariants(ctx, {
      aspect,
      brief: meta.flyer_brief,
      style: meta.flyer_style,
      styles,
      emailCopy,
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
      draftId,
      usageDeltas,
    });
    const first = variants[0];

    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const nextMeta: DraftMeta = {
      ...mirrorVariant(first),
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

  const usageDeltas: UsageDelta[] = [];
  const copies = await generateFlyerVariants(ctx, {
    aspect,
    brief: meta.flyer_brief,
    style: fixedStyle,
    styles,
    emailCopy,
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
    draftId,
    usageDeltas,
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
      ...(meta.source_draft_id ? { source_draft_id: meta.source_draft_id } : {}),
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

  const finalPrompt = args.exactPrompt
    ? reference
      ? `${args.exactPrompt} A reference image is attached: match its visual style, layout language, color treatment, and mood, but keep the text content exactly as specified above.`
      : args.exactPrompt
    : buildFlyerImagePrompt(
        args.copy,
        resolveBrandTokens(args.ctx.brand),
        args.aspect,
        Boolean(reference),
        args.style,
      );

  const imageModel =
    args.model ??
    resolveImageModel(args.ctx.brand.visual_identity?.image_gen?.model);
  const rendered = await generateGeminiImage({
    prompt: finalPrompt,
    aspectRatio: args.aspect,
    reference,
    model: imageModel,
  });
  usageDeltas.push({ model: imageModel, images: 1 });
  logImageUsage("flyer-image-regenerate", imageModel, 1, {
    brandId: args.ctx.brand.id,
    draftId: args.draftId,
    metered: true,
  });

  const optimized = await optimizeFlyerImage(
    rendered.data,
    FLYER_ASPECTS[args.aspect],
  );
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
  );

  const imageModel =
    opts.model ?? resolveImageModel(ctx.brand.visual_identity?.image_gen?.model);
  const rendered = await generateGeminiImage({
    prompt: finalPrompt,
    aspectRatio: opts.aspect,
    reference: reference ?? undefined,
    model: imageModel,
  });
  opts.usageDeltas.push({ model: imageModel, images: 1 });
  logImageUsage("flyer-image", imageModel, 1, {
    brandId: ctx.brand.id,
    draftId: opts.draftId,
    metered: true,
  });

  const optimized = await optimizeFlyerImage(
    rendered.data,
    FLYER_ASPECTS[opts.aspect],
  );
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
 * Renders every option in parallel on the lite (preview) tier. A failed
 * render just means one fewer option; only all of them failing is an error.
 * Usage is recorded per successful render, so a failure isn't billed.
 */
async function renderFlyerVariants(
  ctx: TopicContext,
  copies: FlyerCopyOutput[],
  styles: (FlyerStyleId | undefined)[],
  opts: {
    aspect: FlyerAspect;
    styleReferenceId?: string;
    draftId: string;
    usageDeltas: UsageDelta[];
  },
): Promise<FlyerVariant[]> {
  const model = resolveImageModel("lite");
  const results = await Promise.allSettled(
    copies.map((copy, i) =>
      renderFlyer(ctx, copy, { ...opts, style: styles[i], model }),
    ),
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
      image: result.value,
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
  };
}

/**
 * The copy + scene call for every option at once: forced tool use with one
 * retry, the same reliability pattern as generateBlogCopy. One call instead of
 * one per option: the brand voice/guidelines input is the bulk of the tokens,
 * and this way it's paid once.
 */
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
    rejection: opts.rejection,
    variants: { count, styles: opts.styles },
  });

  const call = async (label: string): Promise<FlyerCopyOutput[]> => {
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 4096,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [FLYER_VARIANTS_TOOL],
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
      tu && tu.type === "tool_use" ? parseFlyerVariants(tu.input, count) : [];
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
