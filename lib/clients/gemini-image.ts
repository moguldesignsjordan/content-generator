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
// Which model and size each quality choice maps to lives in
// lib/clients/image-render.ts (it also dispatches to the optional OpenAI
// engine). Model keys here are "model@size", e.g. "gemini-nano-banana-2.1@1K";
// a bare id renders 1K.
// ─────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.GEMINI_API_KEY;

export type ImageSize = "1K" | "2K" | "4K";

/** "gemini-nano-banana-2.1@2K" → its id and output size; a bare id is 1K. */
export function splitImageModel(key: string): { id: string; size: ImageSize } {
  const [id, size] = key.split("@");
  return { id, size: size === "2K" || size === "4K" ? size : "1K" };
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
  /** More reference images, sent after `reference` in order (e.g. a product
   * photo, then a style reference). The prompt says which is which. */
  references?: { data: string; mimeType: string }[];
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
  const { prompt, aspectRatio = "16:9", reference, model = "gemini-nano-banana-2.1@1K" } = args;
  const { id: modelId, size } = splitImageModel(model);
  const refs = [...(reference ? [reference] : []), ...(args.references ?? [])];

  // One text part, then one image part per reference (the live docs' shape
  // for multi-reference requests on the Interactions API).
  const input = refs.length
    ? [
        { type: "text" as const, text: prompt },
        ...refs.map((r) => ({
          type: "image" as const,
          data: r.data,
          mime_type: r.mimeType,
        })),
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
      ...(refs.length
        ? {
            reference: refs
              .map((r) => `[${Math.round((r.data.length * 3) / 4 / 1024)} KB ${r.mimeType} omitted]`)
              .join(" "),
          }
        : {}),
    },
  });

  const interaction = await withTransientRetry(() =>
    getGenAI().interactions.create({
      model: modelId,
      input,
      // Don't retain requests/responses server-side; we host the result ourselves.
      store: false,
      response_format: {
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: aspectRatio,
        image_size: size,
      },
    }),
  ).catch((err: unknown) => {
    // A 402 is the Google account's billing, not the request: say so plainly
    // instead of surfacing the SDK's empty httpMeta JSON.
    if (err instanceof Error && /^402\b/.test(err.message)) {
      throw new Error(
        "Image generation is paused: the Gemini account's billing or prepaid credits need attention (402).",
        { cause: err },
      );
    }
    throw err;
  });

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
