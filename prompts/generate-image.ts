import type { Anthropic } from "@anthropic-ai/sdk";
import type { ContentImageStyle, ReferenceUse } from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";

// Image-prompt crafting: a tiny FAST_MODEL call turns topic + headline +
// chosen style + brand palette into a tight prompt for the image model
// (better renders for fractions of a cent). The style scaffolds are
// deterministic code, only the scene/subject description is model-crafted,
// so a style always looks like itself regardless of sampling.

export const IMAGE_STYLE_LABELS: Record<ContentImageStyle, string> = {
  illustration: "Illustration",
  photo: "Photo",
  texture: "Brand texture",
  render3d: "Soft 3D",
  collage: "Collage",
  lineart: "Line art",
};

/** One-line descriptions for the style picker UI. Keep in sync with the scaffolds. */
export const IMAGE_STYLE_DESCRIPTIONS: Record<ContentImageStyle, string> = {
  illustration: "Flat editorial vector art in brand colors, bold and clean.",
  photo: "Premium photography, natural light, graded to the brand palette.",
  texture: "Abstract gradient backdrop built only from brand colors.",
  render3d: "Soft matte 3D shapes with studio lighting, playful but polished.",
  collage: "Layered paper-cutout collage, tactile and editorial.",
  lineart: "Minimal single-line drawing with one accent fill, gallery-sparse.",
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
  render3d:
    "A soft 3D render of {SCENE}. Smooth matte clay-like materials, rounded " +
    "friendly geometry, gentle studio lighting with soft shadows, objects " +
    "floating on a clean backdrop with generous negative space. Colors drawn " +
    "from this brand palette: {PALETTE}. No text, no words, no letters, no " +
    "logos, no watermarks. Modern, high-end product-page quality.",
  collage:
    "A modern editorial paper-cutout collage of {SCENE}. Layered torn and " +
    "cleanly cut paper shapes, subtle drop shadows for real depth, a playful " +
    "but disciplined composition with clear focal hierarchy. Paper stock " +
    "restricted to this brand palette plus paper white: {PALETTE}. No text, no " +
    "letters, no logos, no watermarks. Tactile, magazine-cover quality.",
  lineart:
    "A minimal continuous line-art drawing of {SCENE}. Confident single-weight " +
    "strokes, at most one or two flat accent fills, drawn on a clean background " +
    "tinted from this brand palette: {PALETTE}. Elegant, sparse, gallery " +
    "quality. No text, no words, no letters, no logos, no watermarks.",
};

// Appended to the final render prompt when the user attached a reference
// image, telling the image model how to use it. Exported so the pipeline's
// exact-prompt path can append the same directive without the scaffold.
export const REFERENCE_DIRECTIVES: Record<ReferenceUse, string> = {
  style:
    "A reference image is attached: match its visual style, mood, lighting, " +
    "and treatment, but keep the scene described above (ignore the " +
    "reference's subject).",
  subject:
    "A reference image is attached: feature its subject as the focus of the " +
    "image, rendered in the style described above.",
  both:
    "A reference image is attached: recreate its subject in its visual style, " +
    "refined and composed as described above.",
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
  referenceUse?: ReferenceUse,
): string {
  const c = tokens.colors;
  const palette = [c.primary, c.accent, c.secondary, c.background]
    .filter(Boolean)
    .join(", ");
  const base = STYLE_SCAFFOLDS[style]
    .replace("{SCENE}", scene.trim().replace(/\.$/, ""))
    .replace("{PALETTE}", palette);
  return referenceUse ? `${base} ${REFERENCE_DIRECTIVES[referenceUse]}` : base;
}

/** Builds the (system, user) pair for the cheap scene-crafting call. */
export function buildImagePromptMessages(args: {
  brandName: string;
  topicTitle: string;
  headline?: string;
  style: ContentImageStyle;
  /** Optional user-typed subject; when present it drives the scene. */
  subject?: string;
  /** Set when a reference image is attached to the call. */
  referenceUse?: ReferenceUse;
}): { system: string; user: string } {
  const { brandName, topicTitle, headline, style, subject, referenceUse } = args;

  const system = [
    "You write scene descriptions for marketing hero images (emails and blog",
    "posts). Given the piece's topic and headline, describe ONE concrete,",
    "visually interesting scene that represents the idea. Rules:",
    "- If the user asked for a specific subject, that request is a hard",
    "  constraint: keep EVERY element they named, in the role they gave it.",
    "  You may add composition detail around their elements, but never remove,",
    "  replace, or reinterpret them into something else.",
    "- Concrete and specific: objects, settings, actions. Never abstract nouns alone.",
    "- No style, palette, lighting, or quality words; a fixed scaffold adds those.",
    "- No text, letters, numbers, screens with readable UI, or logos in the scene.",
    "- For the 'texture' style, describe an abstract composition (shapes,",
    "  gradients, motion), not objects or people.",
    "- For 'lineart', keep it to ONE simple subject that reads as a line drawing.",
    "- For 'collage', describe 2 to 4 distinct elements that can layer as cutouts.",
    "- For 'render3d', favor simple chunky objects over busy environments.",
    "- NEVER use em dashes anywhere.",
    "Call save_image_prompt once.",
  ].join("\n");

  const referenceLine =
    referenceUse === "style"
      ? "A reference image is attached for VISUAL STYLE ONLY: ignore its subject and describe a scene from the topic."
      : referenceUse
        ? "A reference image is attached: build the scene around its subject (name what you see in it, concretely)."
        : "";

  const user = [
    `BRAND: ${brandName}`,
    `EMAIL TOPIC: ${topicTitle}`,
    headline ? `EMAIL HEADLINE: ${headline}` : "",
    `CHOSEN STYLE: ${style}`,
    referenceLine,
    subject
      ? `THE USER ASKED FOR THIS SUBJECT (hard constraint, keep every element they named): ${subject}`
      : "No subject given: infer the strongest visual from the topic and headline.",
    "",
    "Call save_image_prompt with the scene and alt text.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
