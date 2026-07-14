import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
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
import { getAdminClient } from "@/lib/db/client";
import { optimizeEmailImage } from "@/lib/images/optimize";
import {
  IMAGE_PROMPT_TOOL,
  REFERENCE_DIRECTIVES,
  buildFinalImagePrompt,
  buildImagePromptMessages,
  type ImagePromptOutput,
} from "@/prompts/generate-image";
import { stripEmDashes } from "@/lib/text";
import type {
  ContentImage,
  ContentImageStyle,
  ImagePromptMode,
  ReferenceUse,
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
    );
    alt = promptOut.alt;
  }

  // 2. Render. 16:9 fits the 600px email column as a wide hero.
  const rendered = await generateGeminiImage({
    prompt: finalPrompt,
    aspectRatio: "16:9",
    reference,
  });
  usage.push({ model: FAST_MODEL, images: 1 });
  logImageUsage("image-render", IMAGE_MODEL, 1, {
    brandId: args.brandId,
    draftId: args.draftId,
    metered: true,
  });

  // 3. Optimize for email (JPEG, 1200px, < ~150KB).
  const optimized = await optimizeEmailImage(rendered.data);

  // 4. Host on the public content-images bucket.
  const url = await uploadContentImage(optimized.data);

  return {
    image: {
      url,
      alt: stripEmDashes(alt.trim()).slice(0, 160),
      width: optimized.width,
      height: optimized.height,
      style: args.style,
      prompt: finalPrompt,
    },
    usage,
  };
}

/**
 * The no-AI path: takes a user-uploaded image, optimizes it for email (same
 * JPEG/size budget as generated ones), hosts it, and returns the ContentImage.
 */
export async function saveUploadedHeroImage(args: {
  file: Buffer;
  alt: string;
}): Promise<ContentImage> {
  let optimized;
  try {
    optimized = await optimizeEmailImage(args.file);
  } catch {
    throw new Error("That file isn't a readable image. Try a JPEG or PNG.");
  }
  const url = await uploadContentImage(optimized.data);
  return {
    url,
    alt: stripEmDashes(args.alt.trim()).slice(0, 160),
    width: optimized.width,
    height: optimized.height,
    style: "uploaded",
  };
}

/** Uploads a JPEG to the content-images bucket, creating it if missing.
 * Exported for the flyer pipeline (lib/pipeline/generate-flyer.ts), which
 * hosts its renders in the same bucket. */
export async function uploadContentImage(data: Buffer): Promise<string> {
  const db = getAdminClient();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  let { error } = await db.storage.from(BUCKET).upload(path, data, {
    contentType: "image/jpeg",
    cacheControl: "31536000", // content-addressed-ish names; safe to cache hard
    upsert: false,
  });

  if (error && /bucket/i.test(error.message)) {
    // Self-heal: first-ever image on a fresh project creates the bucket.
    await db.storage.createBucket(BUCKET, { public: true }).catch(() => {});
    ({ error } = await db.storage.from(BUCKET).upload(path, data, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    }));
  }
  if (error) {
    logError("pipeline:generate-image:storage-upload", error);
    throw new Error("Couldn't save the generated image. Try again.");
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

// The hero splice/remove/render string transforms live in
// lib/email/hero-image.ts (pure, unit-tested); re-exported here so every
// pipeline/route keeps importing them from the image pipeline module.
export {
  removeHeroImage,
  renderHeroImageBlock,
  spliceHeroImage,
} from "@/lib/email/hero-image";
