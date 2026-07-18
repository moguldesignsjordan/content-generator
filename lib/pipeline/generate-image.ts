import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
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
import { getAdminClient } from "@/lib/db/client";
import { createMediaAsset } from "@/lib/db/queries";
import { optimizeEmailImage } from "@/lib/images/optimize";
import {
  IMAGE_PROMPT_TOOL,
  REFERENCE_DIRECTIVES,
  buildFinalImagePrompt,
  buildImagePromptMessages,
  resolveBrandPalette,
  type ImagePromptOutput,
} from "@/prompts/generate-image";
import { stripEmDashes } from "@/lib/text";
import type {
  BrandPaletteMode,
  ContentImage,
  ContentImageStyle,
  ImageModelTier,
  ImagePromptMode,
  ReferenceUse,
  VisualVibe,
} from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { UsageDelta } from "./cost";
import { logError, logImageUsage } from "@/lib/log";

// AI hero images for emails and blogs. Cost discipline: this runs on explicit
// user action from the review screen, or during generation ONLY when the
// brand opted in (visual_identity.image_gen.auto, asked during onboarding);
// the human approval gate still covers the result either way. The scene is
// crafted by FAST_MODEL (cheap), the render is one Gemini call, and the
// result is optimized to an email-safe JPEG hosted on Supabase Storage
// (absolute HTTPS URL; email clients can't load data URIs).

const BUCKET = "content-images";

export { isGeminiConfigured };

export interface GenerateContentImageArgs {
  tokens: BrandTokens;
  /** Who pays: both the scene-crafting call and the render are metered. */
  brandId?: string;
  /** The draft this image belongs to, when there is one (attribution only). */
  draftId?: string;
  brandName: string;
  topicTitle: string;
  headline?: string;
  style: ContentImageStyle;
  /** Optional user-typed subject for the scene. */
  subject?: string;
  /**
   * "auto" (default): FAST_MODEL sharpens the subject into a scene.
   * "exact": the subject is used verbatim as the scene, no model call at all,
   * for when the generator "doesn't listen" and the user wants full control.
   */
  promptMode?: ImagePromptMode;
  /**
   * Full final prompt override (the tweak-and-regenerate path): skips both
   * the scene-crafting call AND the style scaffold; sent to the image model
   * as-is. Wins over subject/promptMode when present.
   */
  exactPrompt?: string;
  /** Optional user-attached reference image (base64 JPEG, already downscaled). */
  reference?: { data: string; mimeType: string };
  /** How the reference steers generation. Defaults to "style" when a reference is present. */
  referenceUse?: ReferenceUse;
  /**
   * Whether the render leans on brand colors ("accents") or stays neutral
   * ("none"). Callers pass the resolved mode (per-image choice or brand
   * pref); omitted, each style's default applies (photo → none, rest →
   * accents). Ignored on the exactPrompt path, where the prompt is verbatim.
   */
  brandPalette?: BrandPaletteMode;
  /** The email's type/tone/vibe, when known: shapes the scene's energy on
   * the "auto" scene-crafting path only (ignored on exact/exactPrompt). */
  emailType?: string;
  tone?: string;
  vibe?: VisualVibe;
  /** Render-model quality tier (per-image choice or the brand's stored
   * default); unset = the standard workhorse, today's behavior. */
  modelTier?: ImageModelTier;
}

export interface GenerateContentImageResult {
  image: ContentImage;
  /** Token/image spend of this operation, for the draft's usage rollup. */
  usage: UsageDelta[];
}

/**
 * Crafts a scene (Haiku) → renders it (Gemini) → optimizes (sharp) → hosts it
 * (Supabase Storage) → returns the ContentImage. Throws with a readable
 * message on any failure; the route surfaces it.
 */
export async function generateContentImage(
  args: GenerateContentImageArgs,
): Promise<GenerateContentImageResult> {
  if (!isGeminiConfigured()) {
    throw new Error(
      "Image generation isn't set up yet: add GEMINI_API_KEY to .env.local.",
    );
  }

  const usage: UsageDelta[] = [];
  const reference = args.reference;
  const referenceUse: ReferenceUse | undefined = reference
    ? (args.referenceUse ?? "style")
    : undefined;
  const exactPrompt = args.exactPrompt?.trim();
  const subject = args.subject?.trim();
  const wantsExact = args.promptMode === "exact" && Boolean(subject);
  const brandPalette = resolveBrandPalette(args.style, undefined, args.brandPalette);

  // 1. Decide the final prompt. Three paths, cheapest first:
  //    - exactPrompt: the user edited the full prompt; send it verbatim.
  //    - exact mode: the user's subject IS the scene; scaffold only. Both of
  //      these skip the FAST_MODEL call entirely (zero Claude tokens).
  //    - auto (default): a cheap scene-crafting call sharpens the subject or
  //      invents one from the topic. When a reference is attached, FAST_MODEL
  //      sees it too, so the scene it writes actually relates to the reference.
  let finalPrompt: string;
  let alt: string;

  if (exactPrompt) {
    finalPrompt = referenceUse
      ? `${exactPrompt} ${REFERENCE_DIRECTIVES[referenceUse]}`
      : exactPrompt;
    alt = subject || args.headline || args.topicTitle;
  } else if (wantsExact) {
    finalPrompt = buildFinalImagePrompt(
      args.style,
      subject!,
      args.tokens,
      referenceUse,
      brandPalette,
    );
    alt = subject!;
  } else {
    const { system, user } = buildImagePromptMessages({
      brandName: args.brandName,
      topicTitle: args.topicTitle,
      headline: args.headline,
      style: args.style,
      subject,
      referenceUse,
      emailType: args.emailType,
      tone: args.tone,
      vibe: args.vibe,
    });
    const userContent: Anthropic.ContentBlockParam[] = [
      { type: "text", text: user },
    ];
    if (reference) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: reference.mimeType as "image/jpeg",
          data: reference.data,
        },
      });
    }
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 512,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: userContent }],
      tools: [IMAGE_PROMPT_TOOL],
      tool_choice: { type: "tool", name: "save_image_prompt" },
    });
    logUsage("image-prompt", FAST_MODEL, response.usage, {
      brandId: args.brandId,
      draftId: args.draftId,
      metered: true,
      requestId: response.id,
    });
    usage.push({ model: FAST_MODEL, ...response.usage });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_image_prompt",
    );
    if (!tu || tu.type !== "tool_use") {
      throw new Error("Couldn't come up with an image concept. Try again.");
    }
    const promptOut = tu.input as ImagePromptOutput;
    if (!promptOut.scene || !promptOut.alt) {
      throw new Error("Couldn't come up with an image concept. Try again.");
    }
    finalPrompt = buildFinalImagePrompt(
      args.style,
      promptOut.scene,
      args.tokens,
      referenceUse,
      brandPalette,
    );
    alt = promptOut.alt;
  }

  // 2. Render. 16:9 fits the 600px email column as a wide hero.
  const imageModel = resolveImageModel(args.modelTier);
  const rendered = await generateGeminiImage({
    prompt: finalPrompt,
    aspectRatio: "16:9",
    reference,
    model: imageModel,
  });
  // Image deltas carry the IMAGE model id so cost rollups price the render
  // at the right tier (tokens are 0 on these, so token rates never apply).
  usage.push({ model: imageModel, images: 1 });
  logImageUsage("image-render", imageModel, 1, {
    brandId: args.brandId,
    draftId: args.draftId,
    metered: true,
  });

  // 3. Optimize for email (1200px, < ~150KB).
  const optimized = await optimizeEmailImage(rendered.data);

  // 4. Host on the public content-images bucket.
  const { url, path } = await uploadContentImage(optimized.data, optimized.format);
  const finalAlt = stripEmDashes(alt.trim()).slice(0, 160);

  if (args.brandId) {
    recordMediaAsset({
      brandId: args.brandId,
      url,
      storagePath: path,
      alt: finalAlt,
      kind: "hero",
      source: "generated",
      style: args.style,
      prompt: finalPrompt,
      width: optimized.width,
      height: optimized.height,
      originDraftId: args.draftId,
    });
  }

  return {
    image: {
      url,
      alt: finalAlt,
      width: optimized.width,
      height: optimized.height,
      style: args.style,
      prompt: finalPrompt,
      // Not meaningful on exactPrompt renders: the prompt was verbatim.
      brand_palette: exactPrompt ? undefined : brandPalette,
    },
    usage,
  };
}

/**
 * The no-AI path: takes a user-uploaded image, optimizes it for email (same
 * size budget as generated ones; PNGs with transparency stay PNG), hosts it,
 * and returns the ContentImage.
 */
export async function saveUploadedHeroImage(args: {
  file: Buffer;
  alt: string;
  /** Who this belongs to, for the media library. Omit to skip recording. */
  brandId?: string;
  draftId?: string;
}): Promise<ContentImage> {
  let optimized;
  try {
    optimized = await optimizeEmailImage(args.file);
  } catch {
    throw new Error("That file isn't a readable image. Try a JPEG or PNG.");
  }
  const { url, path } = await uploadContentImage(optimized.data, optimized.format);
  const alt = stripEmDashes(args.alt.trim()).slice(0, 160);

  if (args.brandId) {
    recordMediaAsset({
      brandId: args.brandId,
      url,
      storagePath: path,
      alt,
      kind: "hero",
      source: "uploaded",
      width: optimized.width,
      height: optimized.height,
      originDraftId: args.draftId,
    });
  }

  return {
    url,
    alt,
    width: optimized.width,
    height: optimized.height,
    style: "uploaded",
  };
}

/**
 * Fetches an already-hosted photo (a product's stored image, or one the user
 * uploaded through the create-agent interview) and hosts it as the draft's
 * hero AS-IS, no AI involved. Non-fatal by design, exactly like the design
 * reference fetch in the generation pipeline: a stale URL or an unreadable
 * file logs a warning and returns undefined so generation falls back to the
 * normal AI-image path instead of failing the whole draft.
 */
export async function useProductPhotoAsHero(
  url: string,
  alt: string,
  brandId?: string,
  draftId?: string,
): Promise<ContentImage | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const optimized = await optimizeEmailImage(Buffer.from(await res.arrayBuffer()));
    const { url: hostedUrl, path } = await uploadContentImage(
      optimized.data,
      optimized.format,
    );
    const finalAlt = stripEmDashes(alt.trim()).slice(0, 160);

    if (brandId) {
      recordMediaAsset({
        brandId,
        url: hostedUrl,
        storagePath: path,
        alt: finalAlt,
        kind: "hero",
        source: "uploaded",
        width: optimized.width,
        height: optimized.height,
        originDraftId: draftId,
      });
    }

    return {
      url: hostedUrl,
      alt: finalAlt,
      width: optimized.width,
      height: optimized.height,
      style: "uploaded",
    };
  } catch (err) {
    logError("pipeline:generate-image:product-photo", err);
    return undefined;
  }
}

/** Uploads an image to the content-images bucket, creating it if missing.
 * Exported for the flyer pipeline (lib/pipeline/generate-flyer.ts), which
 * hosts its renders in the same bucket. Returns the storage path alongside
 * the public URL so callers can record it in the media library (and delete
 * the object later). */
export async function uploadContentImage(
  data: Buffer,
  format: "jpeg" | "png" = "jpeg",
): Promise<{ url: string; path: string }> {
  const db = getAdminClient();
  const ext = format === "png" ? "png" : "jpg";
  const contentType = format === "png" ? "image/png" : "image/jpeg";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  let { error } = await db.storage.from(BUCKET).upload(path, data, {
    contentType,
    cacheControl: "31536000", // content-addressed-ish names; safe to cache hard
    upsert: false,
  });

  if (error && /bucket/i.test(error.message)) {
    // Self-heal: first-ever image on a fresh project creates the bucket.
    await db.storage.createBucket(BUCKET, { public: true }).catch(() => {});
    ({ error } = await db.storage.from(BUCKET).upload(path, data, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    }));
  }
  if (error) {
    logError("pipeline:generate-image:storage-upload", error);
    throw new Error("Couldn't save the generated image. Try again.");
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, path };
}

/** Records a hosted image in the media library. Fire-and-forget: a logging
 * failure must never break the generation/upload it's attached to. */
function recordMediaAsset(args: Parameters<typeof createMediaAsset>[0]): void {
  createMediaAsset(args).catch((err) => {
    logError("pipeline:generate-image:record-media-asset", err);
  });
}

// The hero splice/remove/render string transforms live in
// lib/email/hero-image.ts (pure, unit-tested); re-exported here so every
// pipeline/route keeps importing them from the image pipeline module.
export {
  removeHeroImage,
  renderHeroImageBlock,
  spliceHeroImage,
} from "@/lib/email/hero-image";
