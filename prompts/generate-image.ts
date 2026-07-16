import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  BrandPaletteMode,
  BrandPalettePref,
  ContentImageStyle,
  ReferenceUse,
  VisualVibe,
} from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";

// Which image style best carries each requested vibe (see
// CampaignBrief.visual_vibe), used as the auto-image default in place of the
// brand's generic stored style when a piece has an explicit vibe. An explicit
// user style choice (the image sheet) always wins over both.
export const VISUAL_VIBE_IMAGE_STYLE: Record<VisualVibe, ContentImageStyle> = {
  punchy: "collage",
  playful: "illustration",
  sleek: "lineart",
  premium: "photo",
};

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
  illustration: "Flat editorial vector art, neutral base with brand-color accents.",
  photo: "Premium photography, natural light, true-to-life color.",
  texture: "Abstract gradient backdrop built only from brand colors.",
  render3d: "Soft matte 3D shapes with studio lighting, playful but polished.",
  collage: "Layered paper-cutout collage, tactile and editorial.",
  lineart: "Minimal single-line drawing with one accent fill, gallery-sparse.",
};

// The deterministic halves of each prompt. {SCENE} is the model-crafted
// subject; {COLOR} is the style's color treatment (branded or neutral, below).
const STYLE_SCAFFOLDS: Record<ContentImageStyle, string> = {
  illustration:
    "A modern flat vector-style editorial illustration of {SCENE}. Clean bold " +
    "shapes, minimal detail, generous negative space, confident composition. " +
    "{COLOR} No text, no words, no letters, no logos, no watermarks. " +
    "Crisp edges, print quality.",
  photo:
    "A premium editorial photograph of {SCENE}. Natural light, shallow depth of " +
    "field, uncluttered composition with clear negative space, {COLOR} " +
    "Photorealistic, no text, no words, no logos, no watermarks.",
  texture:
    "An abstract brand background texture: {SCENE}. Soft gradients, layered " +
    "organic shapes or subtle geometry, depth without clutter, {COLOR} " +
    "No objects, no people, no text, no letters, no logos. Smooth, high-end, " +
    "suitable as an email header backdrop.",
  render3d:
    "A soft 3D render of {SCENE}. Smooth matte clay-like materials, rounded " +
    "friendly geometry, gentle studio lighting with soft shadows, objects " +
    "floating on a clean neutral backdrop (soft gray or off-white) with " +
    "generous negative space. {COLOR} No text, no words, no letters, no " +
    "logos, no watermarks. Modern, high-end product-page quality.",
  collage:
    "A modern editorial paper-cutout collage of {SCENE}. Layered torn and " +
    "cleanly cut paper shapes, subtle drop shadows for real depth, a playful " +
    "but disciplined composition with clear focal hierarchy. {COLOR} No text, " +
    "no letters, no logos, no watermarks. Tactile, magazine-cover quality.",
  lineart:
    "A minimal continuous line-art drawing of {SCENE}. Confident single-weight " +
    "strokes in a dark neutral ink on a clean near-white background, {COLOR} " +
    "Elegant, sparse, gallery quality. No text, no words, no letters, no " +
    "logos, no watermarks.",
};

// Per-style color treatments: `accents` steers toward the brand palette
// ({PALETTE} is the brand's real hex values); `none` keeps the render's
// colors natural/editorial with no brand steering at all. Realistic photos
// especially read as artificially tinted when force-graded to a palette,
// which is why photo defaults to `none` (see resolveBrandPalette).
const COLOR_TREATMENTS: Record<
  ContentImageStyle,
  Record<BrandPaletteMode, string>
> = {
  illustration: {
    accents:
      "A calm neutral base of soft grays, off-whites, and muted naturals, with " +
      "these brand colors used sparingly as deliberate accents on a few focal " +
      "shapes: {PALETTE}.",
    none:
      "A calm neutral base of soft grays, off-whites, and muted naturals, with " +
      "a restrained editorial palette: one or two confident accent hues that " +
      "suit the subject.",
  },
  photo: {
    accents:
      "color-graded to harmonize with this brand palette: {PALETTE}.",
    none: "natural true-to-life color grading, nothing artificially tinted.",
  },
  texture: {
    accents:
      "built ONLY from these brand colors and tints of them: {PALETTE}.",
    none:
      "built from a small family of soft, harmonious tones that suit the mood.",
  },
  render3d: {
    accents:
      "Mostly soft neutral tones, with these brand colors appearing as accents " +
      "on one or two hero objects: {PALETTE}.",
    none:
      "Mostly soft neutral tones, with one or two tasteful accent colors on " +
      "the hero objects.",
  },
  collage: {
    accents:
      "Mostly paper white, kraft, and soft gray stock, with a few pieces cut " +
      "from these brand colors as accents: {PALETTE}.",
    none:
      "Mostly paper white, kraft, and soft gray stock, with a few pieces in " +
      "muted editorial accent colors.",
  },
  lineart: {
    accents:
      "with at most one or two small flat accent fills drawn from this brand " +
      "palette: {PALETTE}.",
    none:
      "with at most one or two small flat accent fills in a color that suits " +
      "the subject.",
  },
};

/**
 * Resolves whether a render should lean on brand colors. Precedence:
 * per-image override (the sheet's toggle / the chat's answer) → brand-level
 * pref ("always"/"never") → per-style default: photos stay natural, every
 * graphic style gets brand accents.
 */
export function resolveBrandPalette(
  style: ContentImageStyle,
  pref?: BrandPalettePref,
  override?: BrandPaletteMode,
): BrandPaletteMode {
  if (override) return override;
  if (pref === "always") return "accents";
  if (pref === "never") return "none";
  return style === "photo" ? "none" : "accents";
}

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
  brandPalette?: BrandPaletteMode,
): string {
  const c = tokens.colors;
  // Texture is deliberately a pure brand backdrop, so it gets the full
  // palette; every other style reads brand colors as accents over a neutral
  // base, and feeding it the whole gamut makes renders brand-saturated.
  const paletteColors =
    style === "texture"
      ? [c.primary, c.accent, c.secondary, c.background]
      : [c.accent, c.primary];
  const palette = paletteColors.filter(Boolean).join(", ");
  const mode = brandPalette ?? resolveBrandPalette(style);
  const color = COLOR_TREATMENTS[style][mode].replace("{PALETTE}", palette);
  const base = STYLE_SCAFFOLDS[style]
    .replace("{SCENE}", scene.trim().replace(/\.$/, ""))
    .replace("{COLOR}", color);
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
  /** The email's type/tone/vibe, when known: shapes the scene's ENERGY
   * (a busy celebratory moment vs. a single still object), never its style
   * (the scaffold owns palette/lighting/quality words regardless). */
  emailType?: string;
  tone?: string;
  vibe?: VisualVibe;
}): { system: string; user: string } {
  const { brandName, topicTitle, headline, style, subject, referenceUse, emailType, tone, vibe } =
    args;

  const system = [
    "You write scene descriptions for marketing hero images (emails and blog",
    "posts). Given the piece's topic and headline, describe ONE concrete,",
    "visually interesting scene that represents the idea. Rules:",
    "- If the user asked for a specific subject, that request is a hard",
    "  constraint: keep EVERY element they named, in the role they gave it.",
    "  You may add composition detail around their elements, but never remove,",
    "  replace, or reinterpret them into something else.",
    "- Concrete and specific: objects, settings, actions. Never abstract nouns alone.",
    "- Match the email's energy (given below, when known): a punchy or playful",
    "  piece wants a scene with movement, a moment, or a bit of surprise; a",
    "  sleek or premium piece wants one still, considered object with lots of",
    "  breathing room. Energy shows up in WHAT the scene depicts, never in",
    "  style, palette, lighting, or quality words, those stay the scaffold's job.",
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
    emailType ? `EMAIL TYPE: ${emailType}` : "",
    tone ? `TONE: ${tone}` : "",
    vibe ? `VIBE: ${vibe}` : "",
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
