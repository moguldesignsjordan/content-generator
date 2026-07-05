import "server-only";
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
import type { ContentImage, ContentImageStyle } from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { UsageDelta } from "./cost";

// AI hero images for emails (and blog heroes later). Cost discipline: this
// runs ONLY on explicit user action from the review screen, never
// automatically on generation. The scene is crafted by FAST_MODEL (cheap),
// the render is one Gemini call, and the result is optimized to an
// email-safe JPEG hosted on Supabase Storage (absolute HTTPS URL; email
// clients can't load data URIs).

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

  // 1. Cheap scene-crafting call.
  const { system, user } = buildImagePromptMessages({
    brandName: args.brandName,
    topicTitle: args.topicTitle,
    headline: args.headline,
    style: args.style,
    subject: args.subject,
  });
  const response = await getAnthropic().messages.create({
    model: FAST_MODEL,
    max_tokens: 512,
    system: cacheableSystem(system),
    messages: [{ role: "user", content: user }],
    tools: [IMAGE_PROMPT_TOOL],
    tool_choice: { type: "tool", name: "save_image_prompt" },
  });
  logUsage("image-prompt", response.usage);
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
  const finalPrompt = buildFinalImagePrompt(args.style, promptOut.scene, args.tokens);
  const rendered = await generateGeminiImage({
    prompt: finalPrompt,
    aspectRatio: "16:9",
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
    console.error("[generate-image] storage upload failed:", error);
    throw new Error("Couldn't save the generated image. Try again.");
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

// ── Splicing the image into the email HTML ──────────────────────────────────
//
// The hero block is a single flat <div data-region="image"> with no nested
// divs, so it can be found and replaced with a non-greedy regex safely. The
// <img> follows email best practice: explicit dimensions, display:block,
// max-width:100%, meaningful alt, never a CSS background-image.

const HERO_BLOCK_RE = /<div data-region="image"[\s\S]*?<\/div>/;

export function renderHeroImageBlock(img: ContentImage): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return (
    `<div data-region="image" style="margin:0 0 28px;">` +
    `<img src="${esc(img.url)}" alt="${esc(img.alt)}" width="552" ` +
    `style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:12px;" />` +
    `</div>`
  );
}

/**
 * Places (or replaces) the hero image block in a draft's HTML. Insertion
 * order of preference: replace an existing image region → before the
 * headline → before the first body region. Returns null when no anchor
 * exists (a document with no tagged regions can't be spliced safely).
 */
export function spliceHeroImage(html: string, img: ContentImage): string | null {
  const block = renderHeroImageBlock(img);

  if (HERO_BLOCK_RE.test(html)) {
    return html.replace(HERO_BLOCK_RE, block);
  }

  for (const anchor of ['data-region="headline"', 'data-region="body"']) {
    const attrIdx = html.indexOf(anchor);
    if (attrIdx === -1) continue;
    const tagStart = html.lastIndexOf("<", attrIdx);
    if (tagStart === -1) continue;
    return html.slice(0, tagStart) + block + html.slice(tagStart);
  }
  return null;
}

/** Removes the hero image block. Returns the html unchanged if none exists. */
export function removeHeroImage(html: string): string {
  return html.replace(HERO_BLOCK_RE, "");
}
