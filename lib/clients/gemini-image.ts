import "server-only";
import { GoogleGenAI } from "@google/genai";

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
// Model: the docs now mark the plan's original gemini-2.5-flash-image as
// legacy; gemini-3.1-flash-image is the current recommended workhorse. Kept
// overridable via GEMINI_IMAGE_MODEL without a code change.
// ─────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.GEMINI_API_KEY;

export const IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";

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
}

/**
 * Renders one image and returns its raw bytes. The caller optimizes for email
 * (resize/compress) and hosts it; nothing here touches storage.
 */
export async function generateGeminiImage(
  args: GeminiImageArgs,
): Promise<{ data: Buffer; mimeType: string }> {
  const { prompt, aspectRatio = "16:9", reference } = args;

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

  const interaction = await withTransientRetry(() =>
    getGenAI().interactions.create({
      model: IMAGE_MODEL,
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
      `Gemini returned no image (model ${IMAGE_MODEL}). Try rephrasing the subject.`,
    );
  }
  return {
    data: Buffer.from(image.data, "base64"),
    mimeType: image.mime_type ?? "image/jpeg",
  };
}
