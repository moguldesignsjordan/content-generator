import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
import {
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
import { generateGeminiImage, isGeminiConfigured } from "@/lib/clients/gemini-image";
import { getAdminClient } from "@/lib/db/client";
import { optimizeEmailImage } from "@/lib/images/optimize";
import {
  IMAGE_PROMPT_TOOL,
  buildFinalImagePrompt,
  buildImagePromptMessages,
  type ImagePromptOutput,
} from "@/prompts/generate-image";
import { stripEmDashes } from "@/lib/text";
import type { ContentImage, ContentImageStyle, ReferenceUse } from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { UsageDelta } from "./cost";
import { logError } from "@/lib/log";

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
  brandName: string;
  topicTitle: string;
  headline?: string;
  style: ContentImageStyle;
  /** Optional user-typed subject for the scene. */
  subject?: string;
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

  // 1. Cheap scene-crafting call. When a reference is attached, FAST_MODEL
  // sees it too, so the scene it writes actually relates to the reference.
  const { system, user } = buildImagePromptMessages({
    brandName: args.brandName,
    topicTitle: args.topicTitle,
    headline: args.headline,
    style: args.style,
    subject: args.subject,
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
  logUsage("image-prompt", FAST_MODEL, response.usage);
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

  // 2. Render. 16:9 fits the 600px email column as a wide hero.
  const finalPrompt = buildFinalImagePrompt(
    args.style,
    promptOut.scene,
    args.tokens,
    referenceUse,
  );
  const rendered = await generateGeminiImage({
    prompt: finalPrompt,
    aspectRatio: "16:9",
    reference,
  });
  usage.push({ model: FAST_MODEL, images: 1 });

  // 3. Optimize for email (JPEG, 1200px, < ~150KB).
  const optimized = await optimizeEmailImage(rendered.data);

  // 4. Host on the public content-images bucket.
  const url = await uploadContentImage(optimized.data);

  return {
    image: {
      url,
      alt: stripEmDashes(promptOut.alt.trim()).slice(0, 160),
      width: optimized.width,
      height: optimized.height,
      style: args.style,
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

/** Uploads a JPEG to the content-images bucket, creating it if missing. */
async function uploadContentImage(data: Buffer): Promise<string> {
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
