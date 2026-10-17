import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
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
  getDefaultDesignLook,
  getDesignLook,
  getHouseStyleExamples,
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
import { extractLookProfile, loadLookImages } from "./extract-look";
import { loadCompetitorRef } from "./competitor-ref";
import { readImageText } from "./read-image-text";
import { pickLayout, quietZoneFor } from "@/lib/flyer/layout";
import { resolveBrandTokens, type BrandTokens } from "@/lib/email/templates/types";
import { buildBrandContext, buildCampaignBriefBlock } from "@/prompts/brand-voice";
import {
  DEFAULT_FLYER_ASPECT,
  FLYER_ASPECTS,
  FLYER_VARIANT_COUNT,
  flyerVariantsTool,
  buildFlyerCopyMessages,
  buildFlyerDesignPrompt,
  buildFlyerImagePrompt,
  buildPlaceImagePrompt,
  parseFlyerVariants,
  resolveVariantStyles,
  type FlyerCopyOutput,
} from "@/prompts/generate-flyer";
import { stripEmDashes } from "@/lib/text";
import type {
  CampaignBrief,
  ClientBrand,
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
  PieceInputs,
  TopicContext,
} from "@/lib/db/types";
import { MAX_PHOTOS_PER_DESIGN } from "@/lib/db/types";
import { effectiveStyle, followedStyleImages, inputsOf } from "@/lib/inputs";
import { MAX_DRAFT_VERSIONS } from "./constants";
import { accumulateUsage, type UsageDelta } from "./cost";
import type { GenerationEvent } from "./generate";
import { logError, logImageUsage, logWarn } from "@/lib/log";
import { publicError } from "@/lib/provider-outage";

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

    const inputs = inputsOf(meta);
    const competitorRef = await loadCompetitorRef(
      inputs.competitor_reference_ids?.[0],
      ctx.brand.id,
      draftId,
    );

    const usageDeltas: UsageDelta[] = [];
    const look = await resolveFlyerLook(meta, inputs, ctx.brand.id, draftId, usageDeltas);
    const photos = await loadPhotos(flyerPhotoUrls(inputs, ctx), draftId);
    // Explicit preset → every option uses it; a look or uploaded reference →
    // no preset (the reference IS the style); neither → a distinct look per option.
    const styles = resolveVariantStyles(draftId, {
      fixedStyle: meta.flyer_style,
      hasReference: Boolean(look || meta.style_reference_id),
      count: meta.flyer_variant_count,
    });

    const copies = await generateFlyerVariants(ctx, {
      aspect,
      brief: withClientNote(withLookNote(meta.flyer_brief, look?.profile), meta.client_brand, ctx.brand.name),
      style: look ? undefined : meta.flyer_style,
      styles,
      emailCopy,
      competitorRef,
      format: meta.flyer_format ?? "post",
      usageDeltas,
      textSlots: look?.profile?.text_slots,
      website: meta.client_brand ? undefined : ctx.brand.visual_identity?.footer?.website,
      phone: meta.client_brand ? undefined : ctx.brand.visual_identity?.footer?.phone,
      photoUrls: photos.map((p) => p.url),
      campaignBrief: meta.series_brief,
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
      photos,
      draftId,
      usageDeltas,
      modelTier: meta.flyer_model,
      look,
      client: await loadClient(meta.client_brand, draftId),
    });
    const first = variants[0];

    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const nextMeta: DraftMeta = {
      ...mirrorVariant(first),
      ...(look && look.id !== ATTACHED_LOOK_ID ? { look_id: look.id } : {}),
      ...(look?.id === ATTACHED_LOOK_ID && look.profile ? { reference_profile: look.profile } : {}),
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
    // Stored on the draft and shown to the client, so never the provider's text.
    const { message } = publicError(err, "Generation failed.");
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

  const inputs = inputsOf(meta);
  const competitorRef = await loadCompetitorRef(
    inputs.competitor_reference_ids?.[0],
    ctx.brand.id,
    draftId,
  );

  const usageDeltas: UsageDelta[] = [];
  const look = await resolveFlyerLook(meta, inputs, ctx.brand.id, draftId, usageDeltas);
  const photos = await loadPhotos(flyerPhotoUrls(inputs, ctx), draftId);
  // Seeded by the next version so a rejection re-rolls the looks too.
  const styles = resolveVariantStyles(`${draftId}:${latestVersion + 1}`, {
    fixedStyle,
    hasReference: Boolean(look || meta.style_reference_id),
    count: meta.flyer_variant_count,
  });

  const copies = await generateFlyerVariants(ctx, {
    aspect,
    brief: withClientNote(withLookNote(meta.flyer_brief, look?.profile), meta.client_brand, ctx.brand.name),
    style: look ? undefined : fixedStyle,
    styles,
    emailCopy,
    competitorRef,
    format: meta.flyer_format ?? "post",
    usageDeltas,
    textSlots: look?.profile?.text_slots,
    website: meta.client_brand ? undefined : ctx.brand.visual_identity?.footer?.website,
    phone: meta.client_brand ? undefined : ctx.brand.visual_identity?.footer?.phone,
    rejection: {
      feedback,
      previousHeadline: meta.flyer_copy?.headline ?? draftCtx.content.subject,
      previousCaption: meta.flyer_copy?.caption,
    },
    photoUrls: photos.map((p) => p.url),
    campaignBrief: meta.series_brief,
  });

  const variants = await renderFlyerVariants(ctx, copies, styles, {
    aspect,
    styleReferenceId: meta.style_reference_id,
    photos,
    draftId,
    usageDeltas,
    modelTier: meta.flyer_model,
    look,
    client: await loadClient(meta.client_brand, draftId),
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
      ...(meta.series_brief ? { series_brief: meta.series_brief } : {}),
      ...(meta.style_reference_id
        ? { style_reference_id: meta.style_reference_id }
        : {}),
      // Older drafts' separate fields become inputs on the new version.
      ...(Object.keys(inputs).length ? { inputs } : {}),
      ...(meta.flyer_format ? { flyer_format: meta.flyer_format } : {}),
      ...(meta.source_draft_id ? { source_draft_id: meta.source_draft_id } : {}),
      // A rejected scheduled post keeps its day in the weekly queue.
      ...(meta.planned_publish_at ? { planned_publish_at: meta.planned_publish_at } : {}),
      ...(meta.flyer_model ? { flyer_model: meta.flyer_model } : {}),
      ...(meta.flyer_variant_count ? { flyer_variant_count: meta.flyer_variant_count } : {}),
      ...(look && look.id !== ATTACHED_LOOK_ID ? { look_id: look.id } : {}),
      ...(look?.id === ATTACHED_LOOK_ID && look.profile ? { reference_profile: look.profile } : {}),
      ...(meta.client_brand ? { client_brand: meta.client_brand } : {}),
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
  /** The draft's inputs (inputsOf(meta)): its photos and style. */
  inputs: PieceInputs;
  /** meta.look_id: the look the first render settled on, kept on re-render. */
  cachedLookId?: string;
  /** meta.reference_profile: the style images' design, already read. */
  referenceProfile?: DesignLookProfile;
  /** The picked option's own photos; unset uses the draft's. */
  photoUrls?: string[];
  /** meta.client_brand: the business the flyer is for. */
  clientBrand?: ClientBrand;
  /** meta.flyer_variant_index: keeps the picked option's riff on re-render. */
  variantIndex?: number;
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
  const client = await loadClient(args.clientBrand, args.draftId);
  const tokens = flyerTokens(args.ctx, client?.brand);
  const layout = args.layout ?? pickLayout(0);
  // The exact-prompt path is the user's full control, so it gets no photos.
  const photos = args.exactPrompt
    ? []
    : await loadPhotos(args.photoUrls ?? flyerPhotoUrls(args.inputs, args.ctx), args.draftId);
  const textRead = { brandId: args.ctx.brand.id, draftId: args.draftId, usageDeltas };

  // A flyer that follows a look or style images re-renders as an AI design,
  // text checked; the code-set path below is its fallback, and the
  // exact-prompt path stays the user's full control. A one-off reference is a
  // new style, so it skips both.
  const followsLook =
    Boolean(args.cachedLookId) ||
    Boolean(followedStyleImages(args.inputs)) ||
    args.inputs.style?.kind === "look";
  if (!args.exactPrompt && !args.reference && followsLook) {
    const look = await resolveFlyerLook(
      { look_id: args.cachedLookId, reference_profile: args.referenceProfile },
      args.inputs,
      args.ctx.brand.id,
      args.draftId,
      usageDeltas,
    );
    if (look) {
      const designed = await renderDesignedFlyer(args.ctx, args.copy, {
        aspect: args.aspect,
        look,
        examplesText: await readExamplesText(look, textRead),
        photosText: await readPhotosText(photos, textRead),
        model: args.model ?? resolveImageModel(args.ctx.brand.visual_identity?.image_gen?.model),
        photos,
        draftId: args.draftId,
        usageDeltas,
        client,
        riff: look.riffs ? args.variantIndex ?? 0 : undefined,
      });
      if (designed) return { image: designed, usage: usageDeltas };
    }
  } else if (!args.exactPrompt && !reference && !args.layout) {
    // An option designed without a reference re-renders the same way.
    const designed = await renderDesignedFlyer(args.ctx, args.copy, {
      aspect: args.aspect,
      look: NO_REFERENCE_LOOK,
      style: args.style,
      model: args.model ?? resolveImageModel(args.ctx.brand.visual_identity?.image_gen?.model),
      photos,
      photosText: await readPhotosText(photos, textRead),
      draftId: args.draftId,
      usageDeltas,
      client,
    });
    if (designed) return { image: designed, usage: usageDeltas };
  }

  // The exact-prompt path is the user's full control: the model draws
  // whatever the prompt says, text included, and nothing is composed on top.
  // Every other path draws text-free art and composes the text in code.
  const finalPrompt = args.exactPrompt
    ? reference
      ? `${args.exactPrompt} A reference image is attached: match its visual style, layout language, color treatment, and mood, but keep the text content exactly as specified above.`
      : args.exactPrompt
    : buildFlyerImagePrompt(args.copy, tokens, args.aspect, Boolean(reference), args.style, {
        photoCount: photos.length,
        quietZone: quietZoneFor(layout),
      });

  const rendered = await renderImage({
    model:
      args.model ?? resolveImageModel(args.ctx.brand.visual_identity?.image_gen?.model),
    prompt: finalPrompt,
    aspectRatio: args.aspect,
    // The photos first, then the style: the prompt names them in that order.
    references: [...photos.map(referenceOf), ...(reference ? [reference] : [])],
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
 * "Put it in the design": edits the current flyer so it includes the owner's
 * image (a product, a person, a logo) and keeps the rest. The edit redraws
 * the text, so it's read back like a designed flyer: the lines the current
 * flyer shows must survive, one retry, then an error instead of a misspelled
 * flyer. When the read itself fails the edit is kept, unverified: the owner
 * is looking right at it, and nothing publishes without their approval.
 */
export async function placeImageInFlyer(args: {
  ctx: TopicContext;
  copy: FlyerCopyOutput;
  aspect: FlyerAspect;
  currentImageUrl: string;
  subject: { data: string; mimeType: string };
  note?: string;
  model?: string;
  /** meta.client_brand: its logo's words are expected in the design. */
  clientBrand?: ClientBrand;
  draftId: string;
}): Promise<{ image: ContentImage; usage: UsageDelta[] }> {
  if (!isGeminiConfigured()) {
    throw new Error("Image generation isn't set up yet: add GEMINI_API_KEY to .env.local.");
  }
  const usageDeltas: UsageDelta[] = [];
  const readOpts = { brandId: args.ctx.brand.id, draftId: args.draftId, usageDeltas };
  const toPreview = (data: Buffer) =>
    sharp(data).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();

  const res = await fetch(args.currentImageUrl);
  if (!res.ok) throw new Error("Couldn't load the current flyer. Try again.");
  const current = Buffer.from(await res.arrayBuffer());

  // Only the lines this design actually shows (a look can drop the CTA).
  const lines = [
    args.copy.headline,
    args.copy.subtext ?? "",
    ...(args.copy.extras ?? []).map((e) => e.text),
    args.copy.cta ?? "",
  ].filter(Boolean);
  const before = await readImageText(await toPreview(current), readOpts);
  const expected =
    before === null ? [args.copy.headline] : lines.filter((l) => checkRenderedText([l], before).missing.length === 0);
  const logoText = args.clientBrand ? [args.clientBrand.name] : [];

  const model = args.model ?? resolveImageModel(args.ctx.brand.visual_identity?.image_gen?.model);
  const references = [await prepareReferenceImage(current), args.subject];
  let misspelled: string[] | undefined;
  for (let attempt = 0; attempt < DESIGN_ATTEMPTS; attempt++) {
    const prompt = buildPlaceImagePrompt(args.aspect, { note: args.note, misspelled });
    const rendered = await renderImage({ model, prompt, aspectRatio: args.aspect, references, minSize: "2K" });
    usageDeltas.push({ model: rendered.billedModel, images: 1 });
    logImageUsage("flyer-place-image", rendered.billedModel, 1, {
      brandId: args.ctx.brand.id,
      draftId: args.draftId,
      metered: true,
    });

    const seen = await readImageText(await toPreview(rendered.data), readOpts);
    if (seen !== null) {
      const check = checkRenderedText(expected, seen, [...logoText, ...(before ? [before] : [])]);
      if (!check.ok) {
        logWarn("pipeline:generate-flyer:place-text-check", "edited flyer text didn't match", {
          draftId: args.draftId,
          missing: check.missing,
          extra: check.extra.slice(0, 12),
        });
        misspelled = check.missing.length ? check.missing : undefined;
        continue;
      }
    } else {
      logWarn("pipeline:generate-flyer:place-text-check", "couldn't read the edit back; kept unverified", {
        draftId: args.draftId,
      });
    }

    const size = FLYER_ASPECTS[args.aspect];
    const optimized = await optimizeFlyerImage(rendered.data, size);
    const { url, path } = await uploadContentImage(optimized.data);
    const alt = stripEmDashes(args.copy.headline).slice(0, 160);
    recordFlyerMediaAsset({
      brandId: args.ctx.brand.id,
      url,
      storagePath: path,
      alt,
      prompt,
      width: optimized.width,
      height: optimized.height,
      draftId: args.draftId,
    });
    return {
      image: { url, alt, width: optimized.width, height: optimized.height, style: "illustration", prompt },
      usage: usageDeltas,
    };
  }
  throw new Error("The image model kept changing the flyer's text, so nothing was saved. Try again or add a note on where it goes.");
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
    /** The owner's photos this option shows. */
    photos: LoadedPhoto[];
    client?: LoadedClient | null;
  },
): Promise<ContentImage> {
  const reference = await loadStyleReference(opts.styleReferenceId, opts.draftId);
  const tokens = flyerTokens(ctx, opts.client?.brand);
  const finalPrompt = buildFlyerImagePrompt(
    copy,
    tokens,
    opts.aspect,
    Boolean(reference),
    opts.style,
    { photoCount: opts.photos.length, quietZone: quietZoneFor(opts.layout) },
  );

  const rendered = await renderImage({
    model: opts.model ?? resolveImageModel(ctx.brand.visual_identity?.image_gen?.model),
    prompt: finalPrompt,
    aspectRatio: opts.aspect,
    // The photos first, then the style: the prompt names them in that order.
    references: [...opts.photos.map(referenceOf), ...(reference ? [reference] : [])],
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
    /** The piece's photos; each option shows the ones its copy picked. */
    photos: LoadedPhoto[];
    draftId: string;
    usageDeltas: UsageDelta[];
    modelTier?: ImageModelTier;
    /** With a look, each option is AI-designed to follow it, falling back to
     * the code-set layout only if its text can't be verified. */
    look?: ResolvedLook | null;
    client?: LoadedClient | null;
  },
): Promise<FlyerVariant[]> {
  const model = resolveImageModel(
    opts.modelTier ?? ctx.brand.visual_identity?.image_gen?.model,
  );
  const textRead = { brandId: ctx.brand.id, draftId: opts.draftId, usageDeltas: opts.usageDeltas };
  // Only an AI design is text checked; the code-set path sets its own text.
  const designs = Boolean(opts.look) || !opts.styleReferenceId;
  const [examplesText, photosText] = await Promise.all([
    opts.look ? readExamplesText(opts.look, textRead) : Promise.resolve(""),
    designs ? readPhotosText(opts.photos, textRead) : Promise.resolve(""),
  ]);
  const optionPhotos = copies.map((copy) => photosForOption(copy, opts.photos));
  const results = await Promise.allSettled(
    copies.map(async (copy, i) => {
      const shared = { ...opts, photos: optionPhotos[i], photosText, model };
      if (opts.look) {
        const designed = await renderDesignedFlyer(ctx, copy, {
          ...shared,
          look: opts.look,
          riff: opts.look.riffs ? i : undefined,
          examplesText,
        });
        if (designed) return { image: designed, layout: undefined };
      } else if (!opts.styleReferenceId) {
        // No reference: still a real design, each option in its own direction.
        const designed = await renderDesignedFlyer(ctx, copy, {
          ...shared,
          look: NO_REFERENCE_LOOK,
          style: styles[i],
        });
        if (designed) return { image: designed, layout: undefined };
      }
      const layout = pickLayout(i);
      const image = await renderFlyer(ctx, copy, { ...shared, style: styles[i], layout });
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
      ...(optionPhotos[i].length ? { photos: optionPhotos[i].map((p) => p.url) } : {}),
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
    ...(copy.extras?.length ? { extras: copy.extras } : {}),
    ...(copy.mockup?.length ? { mockup: copy.mockup } : {}),
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
    competitorRef: CompetitorReference | null;
    format: FlyerFormat;
    usageDeltas: UsageDelta[];
    /** The look's extra text spots, for the copy to fill. */
    textSlots?: string[];
    website?: string;
    phone?: string;
    rejection?: {
      feedback: string;
      previousHeadline?: string;
      previousCaption?: string;
    };
    /** The owner's photos, shown to the writer so each option picks the ones
     * it shows and stages them as they look. */
    photoUrls?: string[];
    /** The chat's structured brief (meta.series_brief), when it made this flyer. */
    campaignBrief?: CampaignBrief;
  },
): Promise<FlyerCopyOutput[]> {
  const count = opts.styles.length || FLYER_VARIANT_COUNT;
  const photoUrls = opts.photoUrls ?? [];
  const { system, user } = buildFlyerCopyMessages({
    brandName: ctx.brand.name,
    brandContext: buildBrandContext(ctx, "social"),
    topicTitle: ctx.topic.title,
    aspect: opts.aspect,
    brief: opts.brief,
    briefBlock: buildCampaignBriefBlock(opts.campaignBrief ?? null, "social") || undefined,
    style: opts.style,
    emailCopy: opts.emailCopy ?? undefined,
    competitorRef: opts.competitorRef,
    format: opts.format,
    rejection: opts.rejection,
    variants: { count, styles: opts.styles },
    textSlots: opts.textSlots,
    website: opts.website,
    phone: opts.phone,
    photoCount: photoUrls.length,
  });
  const content: Anthropic.MessageParam["content"] = photoUrls.length
    ? [
        ...photoUrls.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
        { type: "text" as const, text: user },
      ]
    : user;

  const call = async (label: string): Promise<FlyerCopyOutput[]> => {
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 4096,
      system: cacheableSystem(system),
      messages: [{ role: "user", content }],
      tools: [flyerVariantsTool(opts.format, Boolean(opts.textSlots?.length), photoUrls.length > 0)],
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
  /** Option 1 stays close to the examples, the rest riff on them. */
  riffs?: boolean;
}

/** ResolvedLook.id for designs attached in chat (never stored as look_id). */
const ATTACHED_LOOK_ID = "attached";

/** No examples: the design follows the option's preset direction instead. */
const NO_REFERENCE_LOOK: ResolvedLook = { id: "none", profile: null, images: [] };

/** What the examples themselves say, read once per generation, so the text
 * check can tell a design that copied their words from one that added its own
 * sample text. Empty when nothing could be read. */
async function readExamplesText(
  look: ResolvedLook,
  opts: { brandId: string; draftId: string; usageDeltas: UsageDelta[] },
): Promise<string> {
  const reads = await Promise.all(
    look.images.map((img) => readImageText(Buffer.from(img.data, "base64"), opts)),
  );
  return reads.filter(Boolean).join("\n");
}

/** The kind of field each preset direction puts behind the text, for the
 * brand color mapping when there's no look profile to say. */
const STYLE_BACKGROUND: Record<FlyerStyleId, DesignLookProfile["color_roles"]["background"]> = {
  bold_type: "vivid",
  minimal: "light",
  photo_backdrop: "photo",
  illustrated: "vivid",
  collage: "light",
  retro_print: "vivid",
  gradient_glow: "dark",
  elegant: "dark",
};

/**
 * The look a flyer follows, per its inputs' style: style images (the owner's
 * designs or ticked ads, read once, with the profile kept on the draft so a
 * re-render doesn't read them again), No reference, or a saved look or Our
 * style (resolveLook), where a look an earlier render settled on (meta.look_id)
 * keeps re-renders on it. Unreadable style images fall through to resolveLook
 * rather than failing the flyer.
 */
async function resolveFlyerLook(
  meta: Pick<DraftMeta, "reference_profile" | "look_id">,
  inputs: PieceInputs,
  brandId: string,
  draftId: string,
  usageDeltas: UsageDelta[],
): Promise<ResolvedLook | null> {
  const styleImages = followedStyleImages(inputs);
  if (styleImages) {
    const examples = styleImages.urls.map((url) => ({ url, source: "library" as const }));
    const images = await loadLookImages(examples, LOOK_EXAMPLES_PER_RENDER);
    if (images.length) {
      const profile = meta.reference_profile ?? (await extractLookProfile(examples, brandId, usageDeltas));
      return { id: ATTACHED_LOOK_ID, profile, images, riffs: true };
    }
    logWarn("pipeline:generate-flyer:attached-refs", "no style image could be loaded", { draftId });
  }
  const style = effectiveStyle(inputs);
  if (style.kind === "none") return null;
  return resolveLook(meta.look_id ?? (style.kind === "look" ? style.look_id : undefined), brandId, draftId);
}

/** The client's brand plus its logo image, ready for the image model. */
interface LoadedClient {
  brand: ClientBrand;
  logo: { data: string; mimeType: string } | null;
}

async function loadClient(brand: ClientBrand | undefined, draftId: string): Promise<LoadedClient | null> {
  if (!brand) return null;
  return { brand, logo: await loadProductPhoto(brand.logo_url, draftId) };
}

/**
 * The tokens a flyer is drawn with: the brand's, or for a client's flyer
 * their colors and no logo (code never stamps the account brand's logo on
 * someone else's flyer; the designed path draws theirs from its image).
 * Without client colors it's a neutral black and white, never the brand's.
 */
function flyerTokens(ctx: TopicContext, client: ClientBrand | undefined): BrandTokens {
  const tokens = resolveBrandTokens(ctx.brand);
  if (!client) return tokens;
  const [primary = "#111114", accent = primary, secondary = accent] = client.colors ?? [];
  return {
    ...tokens,
    logo_url: null,
    logo_alt: client.name,
    colors: { ...tokens.colors, primary, accent, secondary, background: "#FFFFFF", text: "#111114", muted: "#6B7280" },
  };
}

/** Tells the copy writer whose flyer this is, so a client's flyer isn't
 * written as the account's own brand. */
function withClientNote(brief: string | undefined, client: ClientBrand | undefined, brandName: string): string | undefined {
  if (!client) return brief;
  return [
    brief,
    `CLIENT: this flyer is for ${client.name}, a separate business, not ${brandName}. Write the headline, copy, caption, and hashtags as ${client.name}, and never mention ${brandName}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Examples sent per render: with the product photo that's 4 references,
 * inside every image model's limit. */
const LOOK_EXAMPLES_PER_RENDER = 3;

/** meta.look_id for "our style" served by the brand's own flyers (no default
 * look), so a re-render follows the same references. */
const HOUSE_LOOK_ID = "house";

/** What "our style" will follow right now: the default look, else the
 * brand's own flyers, else nothing. Shared by the render path and the chat's
 * check before generating, so the two never disagree. */
export async function describeOurStyle(
  brandId: string,
): Promise<{ lookId: string; name: string; urls: string[]; profile: DesignLookProfile | null } | null> {
  const look = await getDefaultDesignLook(brandId);
  if (look?.examples.length) {
    return { lookId: look.id, name: look.name, urls: look.examples.map((e) => e.url), profile: look.profile };
  }
  const urls = await getHouseStyleExamples(brandId, LOOK_EXAMPLES_PER_RENDER);
  return urls.length ? { lookId: HOUSE_LOOK_ID, name: "flyers they approved or liked", urls, profile: null } : null;
}

/**
 * The look a flyer follows: an explicit saved look, else "our style" (see
 * describeOurStyle). "none" is No reference: the code-set layouts with a
 * fresh preset per option.
 * Non-fatal: a deleted look, a pre-031 DB, or unreadable examples all mean
 * "no look", and the flyer renders the code-set way.
 */
async function resolveLook(
  lookId: string | undefined,
  brandId: string,
  draftId: string,
): Promise<ResolvedLook | null> {
  if (lookId === "none") return null;
  try {
    if (lookId && lookId !== HOUSE_LOOK_ID) {
      const look = await getDesignLook(lookId, brandId);
      if (!look?.examples.length) return null;
      const images = await loadLookImages(look.examples, LOOK_EXAMPLES_PER_RENDER);
      return images.length ? { id: look.id, profile: look.profile, images, riffs: true } : null;
    }
    const ours = await describeOurStyle(brandId);
    if (!ours) return null;
    const images = await loadLookImages(
      ours.urls.map((url) => ({ url, source: "library" as const })),
      LOOK_EXAMPLES_PER_RENDER,
    );
    return images.length ? { id: ours.lookId, profile: ours.profile, images, riffs: true } : null;
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
    /** The owner's photos this option shows, exactly as they look. */
    photos: LoadedPhoto[];
    /** What the photos' own printed labels say (readPhotosText). */
    photosText?: string;
    draftId: string;
    usageDeltas: UsageDelta[];
    client?: LoadedClient | null;
    /** Index into DESIGN_RIFFS for this option. */
    riff?: number;
    /** The preset direction, when there are no examples to follow. */
    style?: FlyerStyleId;
    /** What the examples say (readExamplesText). */
    examplesText?: string;
  },
): Promise<ContentImage | null> {
  const client = opts.client ?? null;
  const tokens = flyerTokens(ctx, client?.brand);
  const profile = opts.look.profile;
  const roles = mapBrandColors(
    tokens.colors,
    profile?.color_roles.background ?? (opts.style ? STYLE_BACKGROUND[opts.style] : "photo"),
  );
  // Photos, examples, then the client's logo: the order the prompt numbers them.
  const references = [
    ...opts.photos.map(referenceOf),
    ...opts.look.images,
    ...(client?.logo ? [client.logo] : []),
  ];
  const expected = [
    copy.headline,
    copy.subtext ?? "",
    ...(copy.extras ?? []).map((e) => e.text),
    copy.cta && profile?.cta_style !== "none" ? copy.cta : "",
  ].filter(Boolean);
  const size = FLYER_ASPECTS[opts.aspect];

  // The brand logo is stamped wherever the look puts it (top-left when
  // unknown), so the prompt keeps exactly that corner clear. A client's logo
  // is drawn by the model there instead, and with no logo image there's none.
  const lookCorner = profile?.logo_placement === "none" ? null : (profile?.logo_placement ?? "top-left");
  const corner = client && !client.logo ? null : lookCorner;
  const stamp = client ? null : corner;
  let misspelled: string[] | undefined;
  for (let attempt = 0; attempt < DESIGN_ATTEMPTS; attempt++) {
    const prompt = buildFlyerDesignPrompt(
      copy,
      tokens,
      opts.aspect,
      { profile, exampleCount: opts.look.images.length, roles, style: opts.style },
      {
        photoCount: opts.photos.length,
        misspelled,
        logoCorner: corner,
        riff: opts.riff,
        ...(client
          ? {
              client: {
                name: client.brand.name,
                hasLogo: Boolean(client.logo),
                hasColors: Boolean(client.brand.colors?.length),
              },
            }
          : {}),
      },
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
    const check = checkRenderedText(
      expected,
      seen,
      // A photographed product's own printed words are expected in the design.
      [...(client ? [client.brand.name] : []), ...(copy.mockup ?? []), ...(opts.photosText ? [opts.photosText] : [])],
      opts.examplesText,
    );
    if (!check.ok) {
      logWarn("pipeline:generate-flyer:text-check", "designed flyer text didn't match", {
        draftId: opts.draftId,
        missing: check.missing,
        copied: check.copied,
        extra: check.extra.slice(0, 12),
      });
      misspelled = check.missing.length ? check.missing : undefined;
      continue;
    }

    const finished =
      stamp === null
        ? rendered.data
        : await stampLogo({ image: rendered.data, tokens, width: size.width, height: size.height, corner: stamp });
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

/** One of the owner's photos, loaded for the image model. */
interface LoadedPhoto {
  url: string;
  data: string;
  mimeType: string;
}

/** A loaded photo as the image model's reference payload. */
function referenceOf(photo: LoadedPhoto): { data: string; mimeType: string } {
  return { data: photo.data, mimeType: photo.mimeType };
}

/** The photos a flyer shows: the owner's, else the topic's product photo. */
function flyerPhotoUrls(inputs: PieceInputs, ctx: TopicContext): string[] {
  const urls = inputs.photos?.length ? inputs.photos : ctx.product?.image_url ? [ctx.product.image_url] : [];
  return urls.slice(0, MAX_PHOTOS_PER_DESIGN);
}

/** Loads each photo, skipping any that can't be read (loadProductPhoto logs it). */
async function loadPhotos(urls: string[], draftId: string): Promise<LoadedPhoto[]> {
  const loaded = await Promise.all(
    urls.map(async (url) => {
      const photo = await loadProductPhoto(url, draftId);
      return photo ? { url, ...photo } : null;
    }),
  );
  return loaded.filter((p): p is LoadedPhoto => p !== null);
}

/** The photos one option shows: the ones its copy picked, else all of them. */
function photosForOption(copy: FlyerCopyOutput, photos: LoadedPhoto[]): LoadedPhoto[] {
  const picked = (copy.photos ?? [])
    .map((n) => photos[n - 1])
    .filter((p): p is LoadedPhoto => Boolean(p));
  return picked.length ? picked : photos;
}

/** What the photos' own printed labels say, read once per generation, so the
 * text check expects those words in a design that shows the products. */
async function readPhotosText(
  photos: LoadedPhoto[],
  opts: { brandId: string; draftId: string; usageDeltas: UsageDelta[] },
): Promise<string> {
  const reads = await Promise.all(
    photos.map((photo) => readImageText(Buffer.from(photo.data, "base64"), opts)),
  );
  return reads.filter(Boolean).join("\n");
}

/**
 * A real product photo the art is built around, as Gemini's reference
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
