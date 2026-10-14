import "server-only";
import type { ImageModelTier } from "@/lib/db/types";
import { DEFAULT_IMAGE_MODEL_TIER } from "@/lib/image-models";
import { generateGeminiImage, splitImageModel, type ImageSize } from "./gemini-image";
import { generateOpenAIImage, isOpenAIImageConfigured } from "./openai-image";

// The one place an image gets rendered. Each model choice (a tier, stored on
// brand prefs and picked per render) maps to a key: Gemini keys are
// "model@size", OpenAI keys are "openai:model@quality". Cost tracking prices
// the same keys (lib/pipeline/cost.ts), so every engine bills the same way.
//
//   standard  Nano Banana 2.1, 1K           the default, $0.0336
//   pro       Nano Banana Pro, 2K           $0.134 (same price as 1K)
//   gpt       GPT Image 2.5 Sunburst, high  optional, ~$0.21
//   gpt_fast  GPT Image 2.5 Flare, medium   optional, ~$0.05
//   lite      saved preference from before Nano Banana 2.1; renders as standard
//
// Each stays overridable via env without a code change.

const STANDARD = process.env.GEMINI_IMAGE_MODEL ?? "gemini-nano-banana-2.1@1K";

export const IMAGE_MODELS: Record<ImageModelTier, string> = {
  standard: STANDARD,
  lite: STANDARD,
  pro: process.env.GEMINI_IMAGE_MODEL_PRO ?? "gemini-3-pro-image@2K",
  gpt: process.env.OPENAI_IMAGE_MODEL ?? "openai:gpt-image-2.5-sunburst@high",
  gpt_fast: process.env.OPENAI_IMAGE_MODEL_FAST ?? "openai:gpt-image-2.5-flare@medium",
};

function isOpenAIKey(key: string): boolean {
  return key.startsWith("openai:");
}

/** Model choices that can render right now (GPT ones need OPENAI_API_KEY).
 * Pages pass this to the pickers so an unusable choice is never offered. */
export function availableImageTiers(): ImageModelTier[] {
  return (Object.keys(IMAGE_MODELS) as ImageModelTier[]).filter(
    (tier) => tier !== "lite" && (!isOpenAIKey(IMAGE_MODELS[tier]) || isOpenAIImageConfigured()),
  );
}

/** Tier → its model key. A GPT choice without an OpenAI key (it was removed
 * after a brand picked it) quietly renders as the standard model. */
export function resolveImageModel(tier?: ImageModelTier): string {
  const key = IMAGE_MODELS[tier ?? DEFAULT_IMAGE_MODEL_TIER] ?? STANDARD;
  return isOpenAIKey(key) && !isOpenAIImageConfigured() ? STANDARD : key;
}

/**
 * Renders one image on whichever engine `model` names. `minSize` asks for at
 * least that output size on Gemini (flyers want 2K at 1080x1350; email heroes
 * are shrunk to 1200px, so 1K is plenty there). Returns the key the render
 * was actually billed at, so cost tracking prices the real size.
 */
export async function renderImage(args: {
  model: string;
  prompt: string;
  aspectRatio: string;
  references?: { data: string; mimeType: string }[];
  minSize?: ImageSize;
}): Promise<{ data: Buffer; mimeType: string; billedModel: string }> {
  if (isOpenAIKey(args.model)) {
    const [id, quality] = args.model.slice("openai:".length).split("@");
    const rendered = await generateOpenAIImage({
      model: id,
      quality: quality === "medium" ? "medium" : "high",
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      references: args.references,
    });
    return { ...rendered, billedModel: args.model };
  }
  const { id, size } = splitImageModel(args.model);
  const order: ImageSize[] = ["1K", "2K", "4K"];
  const finalSize =
    args.minSize && order.indexOf(args.minSize) > order.indexOf(size) ? args.minSize : size;
  const billedModel = `${id}@${finalSize}`;
  const rendered = await generateGeminiImage({
    prompt: args.prompt,
    aspectRatio: args.aspectRatio,
    references: args.references,
    model: billedModel,
  });
  return { ...rendered, billedModel };
}
