import "server-only";
import { GoogleGenAI } from "@google/genai";
import { logPrompt } from "@/lib/log";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only Google GenAI client for image generation ("Nano Banana" family).
//
// Mirrors the shape of lib/clients/anthropic.ts: key read once from env,
// isGeminiConfigured() for graceful degradation, lazy singleton.
//
// API shape verified against the installed @google/genai v2.10.0 types and
// the live docs (2026-07): the Interactions API returns the generated image
// as base64 on interaction.output_image.data, never a URL to fetch.
//
// Models: three quality tiers, all on the same Interactions API (verified
// against the live model docs 2026-07): gemini-3.1-flash-lite-image (fastest,
// 1K only), gemini-3.1-flash-image (the recommended workhorse, today's
// default), gemini-3-pro-image (premium, ~3x per-render cost). Each id stays
// overridable via env without a code change.
// ─────────────────────────────────────────────────────────────────────────────

import type { ImageModelTier } from "@/lib/db/types";
import { DEFAULT_IMAGE_MODEL_TIER } from "@/lib/image-models";

const apiKey = process.env.GEMINI_API_KEY;

export const IMAGE_MODELS: Record<ImageModelTier, string> = {
  lite: process.env.GEMINI_IMAGE_MODEL_LITE ?? "gemini-3.1-flash-lite-image",
  standard: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image",
  pro: process.env.GEMINI_IMAGE_MODEL_PRO ?? "gemini-3-pro-image",
};

/** The default (standard-tier) model; kept for existing imports/logs. */
export const IMAGE_MODEL = IMAGE_MODELS[DEFAULT_IMAGE_MODEL_TIER];

/** Tier → concrete model id, defaulting to the standard workhorse. */
export function resolveImageModel(tier?: ImageModelTier): string {
  return IMAGE_MODELS[tier ?? DEFAULT_IMAGE_MODEL_TIER];
}

export function isGeminiConfigured(): boolean {
  return Boolean(apiKey);
}

let client: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in .env.local.");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * One retry on transient failures (rate limit / overload / flaky network).
 * Image renders are ~20s user-visible waits; a single spaced retry rides out
 * a 429 or 503 without doubling the worst-case wait the way a chain would.
 */
async function withTransientRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const transient = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|fetch failed|ECONNRESET/i.test(
      msg,
    );
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 4000));
    return call();
  }
}

export interface GeminiImageArgs {
  /** The full image-generation prompt (already style-scaffolded). */
  prompt: string;
  /** "16:9" for email heroes; any ratio the API supports. */
  aspectRatio?: string;
  /**
   * Optional reference image (e.g. the brand logo, or the previous hero) so
   * the model can hold palette/style consistency across a set.
   */
  reference?: { data: string; mimeType: string };
  /** Concrete model id (from resolveImageModel); defaults to the standard
   * workhorse so existing callers behave unchanged. */
  model?: string;
}

/**
 * Renders one image and returns its raw bytes. The caller optimizes for email
 * (resize/compress) and hosts it; nothing here touches storage.
 */
export async function generateGeminiImage(
  args: GeminiImageArgs,
): Promise<{ data: Buffer; mimeType: string }> {
  const { prompt, aspectRatio = "16:9", reference, model = IMAGE_MODEL } = args;

  const input = reference
    ? [
        { type: "text" as const, text: prompt },
        {
          type: "image" as const,
          data: reference.data,
          mime_type: reference.mimeType,
        },
      ]
    : prompt;

  // Prompt capture (migration 021): image prompts feed the same /prompts
  // admin page as Claude calls. The reference image is size-only, never bytes.
  logPrompt({
    provider: "gemini",
    endpoint: "/interactions",
    model,
    preview: prompt.split("\n").find((l) => l.trim()) ?? "",
    messageCount: 1,
    request: {
      model,
      prompt,
      aspect_ratio: aspectRatio,
      ...(reference
        ? {
            reference: `[${Math.round((reference.data.length * 3) / 4 / 1024)} KB ${reference.mimeType} omitted]`,
          }
        : {}),
    },
  });

  const interaction = await withTransientRetry(() =>
    getGenAI().interactions.create({
      model,
      input,
      // Don't retain requests/responses server-side; we host the result ourselves.
      store: false,
      response_format: {
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: aspectRatio,
        image_size: "1K",
      },
    }),
  );

  const image = interaction.output_image;
  if (!image?.data) {
    throw new Error(
      `Gemini returned no image (model ${model}). Try rephrasing the subject.`,
    );
  }
  return {
    data: Buffer.from(image.data, "base64"),
    mimeType: image.mime_type ?? "image/jpeg",
  };
}
