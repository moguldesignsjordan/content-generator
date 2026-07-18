import "server-only";
import {
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
import {
  IMAGE_MODEL,
  generateGeminiImage,
  isGeminiConfigured,
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
  FLYER_COPY_TOOL,
  buildFlyerCopyMessages,
  buildFlyerImagePrompt,
  pickVariedFlyerStyle,
  type FlyerCopyOutput,
} from "@/prompts/generate-flyer";
import { stripEmDashes, stripMarkdown } from "@/lib/text";
import type {
  ContentImage,
  DraftMeta,
  DraftUsage,
  EmailCopy,
  FlyerAspect,
  FlyerCopy,
  FlyerStyleId,
  TopicContext,
} from "@/lib/db/types";
import { MAX_DRAFT_VERSIONS } from "./constants";
import { accumulateUsage, type UsageDelta } from "./cost";
import type { GenerationEvent } from "./generate";
import { logError, logImageUsage, logWarn } from "@/lib/log";

// Social flyer generation (content_jobs.type='social'): one FAST_MODEL call
// writes the flyer copy + scene, one Gemini call renders the designed graphic
// (text typeset in the image), sharp fits it to the exact post shape, and the
// result is hosted next to hero images on the content-images bucket. The
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
    // Explicit preset → keep it; uploaded reference → no preset (the
    // reference IS the style); neither → varied per-draft rotation, same
    // "never the same recipe twice" default hero images got.
    const style: FlyerStyleId | undefined =
      meta.flyer_style ??
      (meta.style_reference_id ? undefined : pickVariedFlyerStyle(draftId));

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
    const copy = await generateFlyerCopy(ctx, {
      aspect,
      brief: meta.flyer_brief,
      style,
      emailCopy,
      usageDeltas,
    });

    const rendering = { phase: "image", label: "Designing the flyer" };
    await patchDraftGeneration(draftId, rendering);
    onEvent({ type: "phase", ...rendering });

    const flyerImage = await renderFlyer(ctx, copy, {
      aspect,
      styleReferenceId: meta.style_reference_id,
      style,
      draftId,
      usageDeltas,
    });

    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const nextMeta: DraftMeta = {
      flyer_copy: toFlyerCopy(copy),
      flyer_image: flyerImage,
      flyer_aspect: aspect,
      flyer_scene: copy.scene,
      // The RESOLVED style, so regenerations keep this look, never re-roll.
      ...(style ? { flyer_style: style } : {}),
      usage,
    };

    await populateDraft(draftId, {
      // The EmailDraftContent shape keeps every list/approve/state code path
      // working; html stays empty because a flyer has no HTML body.
      content: {
        subject: copy.headline,
        preheader: copy.caption.slice(0, 120),
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

  const usageDeltas: UsageDelta[] = [];
  const copy = await generateFlyerCopy(ctx, {
    aspect,
    brief: meta.flyer_brief,
    style: meta.flyer_style,
    emailCopy,
    usageDeltas,
    rejection: {
      feedback,
      previousHeadline: meta.flyer_copy?.headline ?? draftCtx.content.subject,
      previousCaption: meta.flyer_copy?.caption,
    },
  });

  const flyerImage = await renderFlyer(ctx, copy, {
    aspect,
    styleReferenceId: meta.style_reference_id,
    style: meta.flyer_style,
    draftId,
    usageDeltas,
  });

  let usage: DraftUsage | undefined;
  for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

  const newDraftId = await persistRegeneratedDraft({
    jobId: draftCtx.jobId,
    version: latestVersion + 1,
    content: {
      subject: copy.headline,
      preheader: copy.caption.slice(0, 120),
      html: "",
    },
    meta: {
      flyer_copy: toFlyerCopy(copy),
      flyer_image: flyerImage,
      flyer_aspect: aspect,
      flyer_scene: copy.scene,
      ...(meta.flyer_brief ? { flyer_brief: meta.flyer_brief } : {}),
      ...(meta.style_reference_id
        ? { style_reference_id: meta.style_reference_id }
        : {}),
      ...(meta.flyer_style ? { flyer_style: meta.flyer_style } : {}),
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

  const rendered = await generateGeminiImage({
    prompt: finalPrompt,
    aspectRatio: args.aspect,
    reference,
  });
  usageDeltas.push({ model: FAST_MODEL, images: 1 });
  logImageUsage("flyer-image-regenerate", IMAGE_MODEL, 1, {
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

  const rendered = await generateGeminiImage({
    prompt: finalPrompt,
    aspectRatio: opts.aspect,
    reference: reference ?? undefined,
  });
  opts.usageDeltas.push({ model: FAST_MODEL, images: 1 });
  logImageUsage("flyer-image", IMAGE_MODEL, 1, {
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
 * The copy + scene call: forced tool use with one retry, the same reliability
 * pattern as generateBlogCopy. Cheap (FAST_MODEL, short output).
 */
async function generateFlyerCopy(
  ctx: TopicContext,
  opts: {
    aspect: FlyerAspect;
    brief?: string;
    style?: FlyerStyleId;
    emailCopy: EmailCopy | null;
    usageDeltas: UsageDelta[];
    rejection?: {
      feedback: string;
      previousHeadline?: string;
      previousCaption?: string;
    };
  },
): Promise<FlyerCopyOutput> {
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
  });

  const call = async (label: string): Promise<FlyerCopyOutput> => {
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 1024,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [FLYER_COPY_TOOL],
      tool_choice: { type: "tool", name: "save_flyer_copy" },
    });
    logUsage(label, FAST_MODEL, response.usage, {
      brandId: ctx.brand.id,
      metered: true,
      requestId: response.id,
    });
    opts.usageDeltas.push({ model: FAST_MODEL, ...response.usage });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_flyer_copy",
    );
    if (!tu || tu.type !== "tool_use") {
      throw new Error("Couldn't come up with flyer copy. Try again.");
    }
    const out = tu.input as Partial<FlyerCopyOutput>;
    if (!out.headline?.trim() || !out.caption?.trim() || !out.scene?.trim()) {
      throw new Error("Couldn't come up with flyer copy. Try again.");
    }
    return cleanFlyerCopy(out as FlyerCopyOutput);
  };

  try {
    return await call("flyer-copy");
  } catch (err) {
    logError("pipeline:generate-flyer:copy", err);
    return await call("flyer-copy-retry");
  }
}

/** Em-dash stripping + trimming across every text field, like the other pipelines. */
function cleanFlyerCopy(out: FlyerCopyOutput): FlyerCopyOutput {
  // Flyer copy is painted onto an image and posted as a caption: markdown the
  // model slipped in would render as literal asterisks either way.
  const plain = (text: string) => stripMarkdown(stripEmDashes(text));
  return {
    headline: plain(out.headline.trim()),
    subtext: out.subtext?.trim() ? plain(out.subtext.trim()) : undefined,
    cta: out.cta?.trim() ? plain(out.cta.trim()) : undefined,
    caption: plain(out.caption.trim()),
    hashtags: (out.hashtags ?? [])
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`)),
    scene: plain(out.scene.trim()),
  };
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
