import "server-only";
import { logPrompt } from "@/lib/log";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only OpenAI image client (GPT Image 2.5), an optional second engine
// next to Gemini. Plain fetch against the REST API, no SDK dependency.
//
// API shape checked against the live image-generation guide (2026-10):
//   POST /v1/images/generations  JSON { model, prompt, size, quality, output_format }
//   POST /v1/images/edits        multipart, same fields plus image[] files
//   → { data: [{ b64_json }] }
// Sizes are WIDTHxHEIGHT in multiples of 16, 655,360 to 8,294,400 pixels,
// aspect between 1:3 and 3:1. A complex prompt can take up to ~2 minutes.
// ─────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.OPENAI_API_KEY;

export function isOpenAIImageConfigured(): boolean {
  return Boolean(apiKey);
}

/** Output size per aspect, sized for our largest use (1080px-wide flyers,
 * 1200px email heroes) while staying inside the API's pixel limits. */
const SIZES: Record<string, string> = {
  "16:9": "1536x864",
  "1:1": "1088x1088",
  "4:5": "1088x1360",
  "9:16": "1088x1936",
};

export async function generateOpenAIImage(args: {
  /** e.g. "gpt-image-2.5-sunburst" */
  model: string;
  quality: "medium" | "high";
  prompt: string;
  aspectRatio: string;
  references?: { data: string; mimeType: string }[];
}): Promise<{ data: Buffer; mimeType: string }> {
  if (!apiKey) {
    throw new Error("GPT Image isn't set up yet: add OPENAI_API_KEY to .env.local.");
  }
  const size = SIZES[args.aspectRatio] ?? "auto";
  const refs = args.references ?? [];

  logPrompt({
    provider: "openai",
    endpoint: refs.length ? "/v1/images/edits" : "/v1/images/generations",
    model: args.model,
    preview: args.prompt.split("\n").find((l) => l.trim()) ?? "",
    messageCount: 1,
    request: {
      model: args.model,
      prompt: args.prompt,
      size,
      quality: args.quality,
      ...(refs.length ? { references: `${refs.length} image(s) omitted` } : {}),
    },
  });

  const send = async () => {
    const init: RequestInit = { method: "POST", signal: AbortSignal.timeout(180_000) };
    let url: string;
    if (refs.length) {
      // References (product photo first, then a style reference) go to the
      // edits endpoint as multipart files.
      const form = new FormData();
      form.append("model", args.model);
      form.append("prompt", args.prompt);
      form.append("size", size);
      form.append("quality", args.quality);
      form.append("output_format", "jpeg");
      refs.forEach((r, i) => {
        const ext = r.mimeType.split("/")[1] ?? "jpeg";
        form.append("image[]", new Blob([Buffer.from(r.data, "base64")], { type: r.mimeType }), `ref-${i}.${ext}`);
      });
      url = "https://api.openai.com/v1/images/edits";
      init.body = form;
      init.headers = { Authorization: `Bearer ${apiKey}` };
    } else {
      url = "https://api.openai.com/v1/images/generations";
      init.body = JSON.stringify({
        model: args.model,
        prompt: args.prompt,
        size,
        quality: args.quality,
        output_format: "jpeg",
      });
      init.headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    }
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => ({}))) as {
      data?: { b64_json?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw Object.assign(
        new Error(`GPT Image ${res.status}: ${body.error?.message ?? "request failed"}`),
        { status: res.status },
      );
    }
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error("GPT Image returned no image. Try rephrasing the subject.");
    return { data: Buffer.from(b64, "base64"), mimeType: "image/jpeg" };
  };

  // One spaced retry on rate limits and server errors, matching the Gemini
  // client; a 400 (bad request or a content-policy refusal) fails straight away.
  try {
    return await send();
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 429 && !(status && status >= 500)) throw err;
    await new Promise((r) => setTimeout(r, 4000));
    return send();
  }
}
