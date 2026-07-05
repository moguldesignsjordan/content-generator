import type { Anthropic } from "@anthropic-ai/sdk";
import type { ContentImageStyle } from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";

// Image-prompt crafting: a tiny FAST_MODEL call turns topic + headline +
// chosen style + brand palette into a tight prompt for the image model
// (better renders for fractions of a cent). The three style scaffolds are
// deterministic code, only the scene/subject description is model-crafted,
// so a style always looks like itself regardless of sampling.

export const IMAGE_STYLE_LABELS: Record<ContentImageStyle, string> = {
  illustration: "Illustration",
  photo: "Photo",
  texture: "Brand texture",
};

// The deterministic halves of each prompt. {SCENE} is the model-crafted
// subject; {PALETTE} is the brand's real hex values.
const STYLE_SCAFFOLDS: Record<ContentImageStyle, string> = {
  illustration:
    "A modern flat vector-style editorial illustration of {SCENE}. Clean bold " +
    "shapes, minimal detail, generous negative space, confident composition. " +
    "Strictly limited palette built from these brand colors: {PALETTE}. No text, " +
    "no words, no letters, no logos, no watermarks. Crisp edges, print quality.",
  photo:
    "A premium editorial photograph of {SCENE}. Natural light, shallow depth of " +
    "field, uncluttered composition with clear negative space, color-graded to " +
    "harmonize with this brand palette: {PALETTE}. Photorealistic, no text, no " +
    "words, no logos, no watermarks.",
  texture:
    "An abstract brand background texture: {SCENE}. Soft gradients, layered " +
    "organic shapes or subtle geometry, depth without clutter, built ONLY from " +
    "these brand colors and tints of them: {PALETTE}. No objects, no people, no " +
    "text, no letters, no logos. Smooth, high-end, suitable as an email header " +
    "backdrop.",
};

export interface ImagePromptOutput {
  scene: string;
  alt: string;
}

/** Forced tool: the model returns just the scene description and alt text. */
export const IMAGE_PROMPT_TOOL: Anthropic.Tool = {
  name: "save_image_prompt",
  description:
    "Return the scene description for the image and its alt text. The scene is " +
    "spliced into a fixed style scaffold; describe only WHAT is depicted, not " +
    "the art style, palette, or quality words (the scaffold handles those).",
  input_schema: {
    type: "object",
    properties: {
      scene: {
        type: "string",
        description:
          "One or two sentences describing the concrete subject/scene that " +
          "visualizes this email's core idea. Concrete nouns and actions, no " +
          "abstractions like 'success' or 'growth' by themselves, no style or " +
          "color words, no text elements.",
      },
      alt: {
        type: "string",
        description:
          "Meaningful alt text for the final image, under 120 characters, " +
          "describing what a reader would see. Never starts with 'Image of'.",
      },
    },
    required: ["scene", "alt"],
  },
};

/** Splices the crafted scene into the chosen style's deterministic scaffold. */
export function buildFinalImagePrompt(
  style: ContentImageStyle,
  scene: string,
  tokens: BrandTokens,
): string {
  const c = tokens.colors;
  const palette = [c.primary, c.accent, c.secondary, c.background]
    .filter(Boolean)
    .join(", ");
  return STYLE_SCAFFOLDS[style]
    .replace("{SCENE}", scene.trim().replace(/\.$/, ""))
    .replace("{PALETTE}", palette);
}

/** Builds the (system, user) pair for the cheap scene-crafting call. */
export function buildImagePromptMessages(args: {
  brandName: string;
  topicTitle: string;
  headline?: string;
  style: ContentImageStyle;
  /** Optional user-typed subject; when present it drives the scene. */
  subject?: string;
}): { system: string; user: string } {
  const { brandName, topicTitle, headline, style, subject } = args;

  const system = [
    "You write scene descriptions for marketing-email hero images. Given the",
    "email's topic and headline, describe ONE concrete, visually interesting",
    "scene that represents the idea. Rules:",
    "- Concrete and specific: objects, settings, actions. Never abstract nouns alone.",
    "- No style, palette, lighting, or quality words; a fixed scaffold adds those.",
    "- No text, letters, numbers, screens with readable UI, or logos in the scene.",
    "- For the 'texture' style, describe an abstract composition (shapes,",
    "  gradients, motion), not objects or people.",
    "- NEVER use em dashes anywhere.",
    "Call save_image_prompt once.",
  ].join("\n");

  const user = [
    `BRAND: ${brandName}`,
    `EMAIL TOPIC: ${topicTitle}`,
    headline ? `EMAIL HEADLINE: ${headline}` : "",
    `CHOSEN STYLE: ${style}`,
    subject
      ? `THE USER ASKED FOR THIS SUBJECT (honor it, sharpen it visually): ${subject}`
      : "No subject given: infer the strongest visual from the topic and headline.",
    "",
    "Call save_image_prompt with the scene and alt text.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
