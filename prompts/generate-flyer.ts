import type { Anthropic } from "@anthropic-ai/sdk";
import {
  AD_CTA_BUTTONS,
  type AdCopy,
  type AdCtaButton,
  type CompetitorReference,
  type EmailCopy,
  type FlyerAspect,
  type FlyerCopy,
  type FlyerFormat,
  type FlyerStyleId,
} from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import { FLYER_STYLE_CATALOG } from "@/lib/design-styles";
import { buildCompetitorReferenceBlock } from "./brand-voice";
import { stripEmDashes, stripMarkdown } from "@/lib/text";

// Flyer prompt assembly: one FAST_MODEL call produces several alternative
// flyers, each with its copy AND a scene concept (save_flyer_variants), then
// buildFlyerImagePrompt turns each into a text-free ARTWORK prompt. The
// headline, supporting line, CTA, and logo are composed on top in code with
// the brand's real fonts (lib/flyer/compose.tsx), so spelling and type are
// always exact and on-brand.

/** Post-shape presets. Width/height are the export targets (IG-native sizes). */
export const FLYER_ASPECTS: Record<
  FlyerAspect,
  { label: string; width: number; height: number }
> = {
  "1:1": { label: "Square post (1:1)", width: 1080, height: 1080 },
  "4:5": { label: "Portrait post (4:5)", width: 1080, height: 1350 },
  "9:16": { label: "Story (9:16)", width: 1080, height: 1920 },
};

export const DEFAULT_FLYER_ASPECT: FlyerAspect = "1:1";

export function isFlyerAspect(value: unknown): value is FlyerAspect {
  return typeof value === "string" && value in FLYER_ASPECTS;
}

// Per-preset design directions spliced into the render prompt (and echoed to
// the copy call so the scene it writes fits the direction). An uploaded style
// REFERENCE image always wins over these: when a reference is attached the
// preset is ignored entirely (the reference IS the style).
export const FLYER_STYLE_DIRECTIONS: Record<FlyerStyleId, string> = {
  bold_type:
    "Style direction: a bold graphic poster look. High-contrast solid color " +
    "blocks and big simple shapes, minimal imagery, a confident grid with a " +
    "large open area where the headline will sit.",
  minimal:
    "Style direction: sleek and minimal. Generous empty space, one small " +
    "focal element, restrained palette, hairline details, quiet premium feel.",
  photo_backdrop:
    "Style direction: a full-bleed photograph drawn from the scene, naturally " +
    "lit, with calm, simple areas where text can sit.",
  illustrated:
    "Style direction: flat vector illustration. Friendly geometric shapes, " +
    "clean edges, generous negative space.",
  collage:
    "Style direction: an editorial paper-cutout collage. Layered elements " +
    "with subtle real shadows, tactile, magazine-cover energy.",
  retro_print:
    "Style direction: a vintage screen-print poster. Bold simplified shapes, " +
    "slightly misregistered ink layers, subtle halftone grain and paper texture.",
  gradient_glow:
    "Style direction: smooth flowing brand-color gradients with a soft glow, " +
    "modern tech-launch energy.",
  elegant:
    "Style direction: premium and elegant. Refined materials, luxurious " +
    "spacing, delicate details, understated color.",
};

export function isFlyerStyle(value: unknown): value is FlyerStyleId {
  return (
    typeof value === "string" && FLYER_STYLE_CATALOG.some((s) => s.id === value)
  );
}

function seedHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** How many options one flyer generation renders. */
export const FLYER_VARIANT_COUNT = 4;

/**
 * `count` DISTINCT presets for a multi-variant generation, a consecutive run
 * of the catalog starting at the seed's slot, so the options differ in look
 * and not only in copy.
 */
export function pickFlyerStyleSet(seed: string, count: number): FlyerStyleId[] {
  const pool = FLYER_STYLE_CATALOG.map((s) => s.id);
  const start = seedHash(seed) % pool.length;
  return Array.from(
    { length: Math.min(count, pool.length) },
    (_, i) => pool[(start + i) % pool.length],
  );
}

/**
 * One style per variant. A fixed preset applies to every option; an uploaded
 * reference means no preset at all (the reference IS the style); otherwise
 * each option gets its own look.
 */
export function resolveVariantStyles(
  seed: string,
  opts: { fixedStyle?: FlyerStyleId; hasReference: boolean },
): (FlyerStyleId | undefined)[] {
  if (opts.hasReference) return Array(FLYER_VARIANT_COUNT).fill(undefined);
  if (opts.fixedStyle) return Array(FLYER_VARIANT_COUNT).fill(opts.fixedStyle);
  return pickFlyerStyleSet(seed, FLYER_VARIANT_COUNT);
}

/** What the copy call returns via forced tool use. */
export interface FlyerCopyOutput extends FlyerCopy {
  /** Visual concept for the background/imagery; never contains the text. */
  scene: string;
}

// One flyer's fields: each item of save_flyer_variants.
const FLYER_COPY_PROPERTIES = {
  headline: {
    type: "string",
    description:
      "The flyer's main line, 8 words or fewer, punchy and concrete. " +
      "Rendered in the image exactly as written. Never use em dashes.",
  },
  subtext: {
    type: "string",
    description:
      "One short supporting line under the headline, 12 words or fewer. " +
      "Rendered in the image. Omit if the headline stands alone.",
  },
  cta: {
    type: "string",
    description:
      "A 2 to 4 word call-to-action for the flyer's button or banner, " +
      "e.g. 'Book a call'. Rendered in the image.",
  },
  caption: {
    type: "string",
    description:
      "The social post caption: 1 to 3 short sentences in the brand " +
      "voice, ending with a clear next step. Plain text, no markdown, " +
      "never use em dashes.",
  },
  hashtags: {
    type: "array",
    items: { type: "string" },
    description:
      "3 to 6 relevant hashtags, each starting with #, camelCase for " +
      "multi-word tags.",
  },
  scene: {
    type: "string",
    description:
      "One or two sentences describing the flyer's imagery and background " +
      "composition: concrete subjects, setting, layout feel. NO text " +
      "content, no color or font words (the render prompt adds those).",
  },
};

const FLYER_COPY_REQUIRED = ["headline", "caption", "scene"];

// An ad swaps the organic caption + hashtags for Meta's ad text fields.
const { caption: _caption, hashtags: _hashtags, ...FLYER_IMAGE_PROPERTIES } =
  FLYER_COPY_PROPERTIES;
const AD_PROPERTIES = {
  ...FLYER_IMAGE_PROPERTIES,
  ad: {
    type: "object",
    description: "The paid ad's text fields, shown around the image in the feed.",
    properties: {
      primary_text: {
        type: "string",
        description:
          "The text above the image: 1 to 3 short sentences in the brand voice. " +
          "Front-load the hook: only about the first 125 characters show " +
          "before 'See more'. Plain text, no hashtags, never use em dashes.",
      },
      headline: {
        type: "string",
        description:
          "The bold line under the image, about 40 characters max. The offer " +
          "or benefit, not a repeat of the on-image headline.",
      },
      description: {
        type: "string",
        description: "One muted supporting line under the headline, about 30 characters max.",
      },
      cta_button: {
        type: "string",
        enum: [...AD_CTA_BUTTONS],
        description: "The ad's button. Pick the one that matches what the reader should do.",
      },
    },
    required: ["primary_text", "headline", "cta_button"],
  },
};
const AD_REQUIRED = ["headline", "ad", "scene"];

/** Forced tool: several complete alternative flyers in one cheap call. */
export function flyerVariantsTool(format: FlyerFormat = "post"): Anthropic.Tool {
  const ad = format === "ad";
  return {
    name: "save_flyer_variants",
    description:
      "Return several alternative flyers for the same topic. Each one is " +
      "complete: its own headline/subtext/cta (typeset INTO the image exactly " +
      `as written), ${ad ? "ad text fields" : "caption, hashtags"}, and scene. ` +
      "Make them genuinely different hooks, not rewordings of one idea.",
    input_schema: {
      type: "object",
      properties: {
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: ad ? AD_PROPERTIES : FLYER_COPY_PROPERTIES,
            required: ad ? AD_REQUIRED : FLYER_COPY_REQUIRED,
          },
        },
      },
      required: ["variants"],
    },
  };
}

/** Builds the (system, user) pair for the flyer variants call. */
export function buildFlyerCopyMessages(args: {
  brandName: string;
  voiceBlock: string;
  guidelinesBlock?: string;
  topicTitle: string;
  aspect: FlyerAspect;
  /** Freeform creative brief typed at creation time, if any. */
  brief?: string;
  /** The design-direction preset, so the scene the model writes fits it
   * (e.g. minimal wants one element, photo_backdrop wants a real setting). */
  style?: FlyerStyleId;
  /** When the flyer is spun off an email draft: distill this email's offer. */
  emailCopy?: EmailCopy;
  /** A saved competitor ad to learn the approach from (strategy only). */
  competitorRef?: CompetitorReference | null;
  /** "ad" writes paid-ad text fields instead of a caption. */
  format?: FlyerFormat;
  /** Reviewer feedback when regenerating a rejected flyer. */
  rejection?: {
    feedback: string;
    previousHeadline?: string;
    previousCaption?: string;
  };
  /** How many alternative flyers to write. `styles` gives each option its
   * own design direction, by position; when they're all the same (or absent),
   * `style` (if any) applies to every option instead. */
  variants: { count: number; styles?: (FlyerStyleId | undefined)[] };
}): { system: string; user: string } {
  const variants = args.variants;
  const perVariantStyles =
    variants.styles && new Set(variants.styles).size > 1 ? variants.styles : null;
  const isAd = args.format === "ad";
  const system = [
    isAd
      ? "You write paid Facebook and Instagram ads: the designed image plus the"
      : "You write copy for social media flyers (Instagram and Facebook post",
    isAd
      ? "ad's text fields. Given a topic and brand context, produce alternative"
      : "graphics). Given a topic and brand context, produce alternative flyers,",
    isAd
      ? "ads, each with its own on-image text, ad text, and visual concept. Rules:"
      : "each with its own on-image text, post caption, and visual concept. Rules:",
    "- headline: 8 words max, concrete benefit or hook, no clickbait.",
    "- subtext: one short line only when it adds something; otherwise omit.",
    "- cta: 2 to 4 words, action verb first.",
    ...(isAd
      ? [
          "- ad.primary_text: hook in the first sentence, about 125 characters",
          "  before it would truncate, one clear reason to act. No hashtags.",
          "- ad.headline and ad.description: short, specific, and different",
          "  from the on-image headline so the ad doesn't say the same thing twice.",
          "- ad.cta_button: the one button that matches the next step.",
        ]
      : ["- caption: 1 to 3 sentences in the brand voice with a clear next step."]),
    "- scene: imagery and composition only. Never describe the text, colors,",
    "  or fonts; the render prompt handles those.",
    "- NEVER use em dashes anywhere.",
    `Call save_flyer_variants once with exactly ${variants.count} variants. ` +
      "Each needs a genuinely different hook and headline, not a rewording " +
      "of another, so the reviewer has real alternatives to choose from.",
  ].join("\n");

  const emailLines = args.emailCopy
    ? [
        "",
        "THIS FLYER PROMOTES AN EXISTING EMAIL. Distill ITS offer into the",
        "flyer (same message, tighter words), don't invent a new angle:",
        `  Email subject: ${args.emailCopy.subject}`,
        `  Email headline: ${args.emailCopy.headline}`,
        ...args.emailCopy.body_sections
          .slice(0, 3)
          .map((s) => `  Email body: ${[s.heading, s.body].filter(Boolean).join(": ")}`),
        `  Email CTA: ${args.emailCopy.cta_text}`,
      ]
    : [];

  const competitorBlock = buildCompetitorReferenceBlock(args.competitorRef);
  const competitorLines = competitorBlock
    ? [
        "",
        competitorBlock,
        ...(args.competitorRef?.competitor_profile?.visual_notes
          ? [`    Layout idea: ${args.competitorRef.competitor_profile.visual_notes}`]
          : []),
        "Treat it as inspiration, not a template. Every variant must read as",
        "this brand's own post about the FLYER TOPIC, with this brand's offer",
        "and wording. At least two variants follow the reference's hook type",
        "and structure; the rest may try something else. A layout idea may",
        "shape a scene, but never recreate the competitor's products, people,",
        "or imagery.",
      ]
    : [];

  const rejectionLines = args.rejection
    ? [
        "",
        "THE PREVIOUS FLYER WAS REJECTED BY THE REVIEWER. Their feedback is a",
        "hard requirement for this rewrite:",
        `  Feedback: ${args.rejection.feedback}`,
        args.rejection.previousHeadline
          ? `  Previous headline (write a different one unless the feedback says to keep it): ${args.rejection.previousHeadline}`
          : "",
        args.rejection.previousCaption
          ? `  Previous caption: ${args.rejection.previousCaption}`
          : "",
      ].filter(Boolean)
    : [];

  const user = [
    args.guidelinesBlock ?? "",
    args.voiceBlock,
    "",
    `FLYER TOPIC: ${args.topicTitle}`,
    `FLYER SHAPE: ${FLYER_ASPECTS[args.aspect].label}`,
    perVariantStyles
      ? [
          "DESIGN DIRECTION PER VARIANT (write each variant's scene to fit its own direction, in this order):",
          ...perVariantStyles.map(
            (id, i) =>
              `  Variant ${i + 1}: ${id ? FLYER_STYLE_DIRECTIONS[id] : "Brand colors, no preset direction."}`,
          ),
        ].join("\n")
      : args.style
        ? `DESIGN DIRECTION (the scene you write must fit it): ${FLYER_STYLE_DIRECTIONS[args.style]}`
        : "",
    args.brief ? `CREATIVE BRIEF FROM THE USER (follow it): ${args.brief}` : "",
    ...emailLines,
    ...competitorLines,
    ...rejectionLines,
    "",
    `Call save_flyer_variants with ${variants.count} complete variants.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

// Flyer copy is painted onto an image and posted as a caption: markdown the
// model slipped in would render as literal asterisks either way.
const plain = (text: string) => stripMarkdown(stripEmDashes(text));

function isAdCtaButton(value: unknown): value is AdCtaButton {
  return AD_CTA_BUTTONS.includes(value as AdCtaButton);
}

/** Cleans an ad's text fields; null when a required one is missing. */
export function cleanAdCopy(raw: unknown): AdCopy | null {
  const ad = raw as Partial<Record<keyof AdCopy, unknown>> | null;
  const primary = typeof ad?.primary_text === "string" ? ad.primary_text.trim() : "";
  const headline = typeof ad?.headline === "string" ? ad.headline.trim() : "";
  if (!primary || !headline) return null;
  const description = typeof ad?.description === "string" ? ad.description.trim() : "";
  return {
    primary_text: plain(primary),
    headline: plain(headline),
    ...(description ? { description: plain(description) } : {}),
    cta_button: isAdCtaButton(ad?.cta_button) ? ad.cta_button : "Learn more",
  };
}

/** Em-dash stripping + trimming across every text field, like the other pipelines. */
export function cleanFlyerCopy(out: FlyerCopyOutput): FlyerCopyOutput {
  return {
    headline: plain(out.headline.trim()),
    subtext: out.subtext?.trim() ? plain(out.subtext.trim()) : undefined,
    cta: out.cta?.trim() ? plain(out.cta.trim()) : undefined,
    caption: plain(out.caption.trim()),
    hashtags: (out.hashtags ?? [])
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`)),
    scene: plain(out.scene.trim()),
  };
}

/**
 * Reads save_flyer_variants input: drops any variant missing a required field,
 * cleans the rest, and caps at `count`. Fewer than asked is fine (fewer
 * options); none at all is the caller's retry signal, so it returns [].
 */
export function parseFlyerVariants(
  input: unknown,
  count: number,
  format: FlyerFormat = "post",
): FlyerCopyOutput[] {
  const raw = (input as { variants?: unknown } | null)?.variants;
  if (!Array.isArray(raw)) return [];
  if (format === "ad") {
    // Ads carry no caption of their own: the primary text stands in for it,
    // so everything that reads flyer_copy.caption keeps working.
    return raw
      .map((v): FlyerCopyOutput | null => {
        const c = v as Partial<FlyerCopyOutput> & { ad?: unknown };
        const ad = cleanAdCopy(c?.ad);
        if (!ad || !c?.headline?.trim() || !c.scene?.trim()) return null;
        const copy = cleanFlyerCopy({
          headline: c.headline,
          subtext: c.subtext,
          cta: c.cta,
          caption: ad.primary_text,
          scene: c.scene,
        });
        return { ...copy, ad };
      })
      .filter((v): v is FlyerCopyOutput => v !== null)
      .slice(0, count);
  }
  return raw
    .filter((v): v is FlyerCopyOutput => {
      const c = v as Partial<FlyerCopyOutput> | null;
      return Boolean(c?.headline?.trim() && c.caption?.trim() && c.scene?.trim());
    })
    .slice(0, count)
    .map(cleanFlyerCopy);
}

/** Where the text panel lands on the composed flyer, so the art keeps that
 * part of the frame calm (see lib/flyer/layout.ts). */
export type FlyerQuietZone = "top" | "bottom" | "none";

/**
 * Builds the render prompt for the flyer's ARTWORK only. The headline,
 * supporting line, CTA, and logo are set on top afterwards in code with the
 * brand's real fonts and colors (lib/flyer/compose.tsx), so the model is told
 * to draw no text at all: image models misspell and off-brand type, code
 * doesn't. Reference images, when attached, come in this order: the product
 * photo (kept exactly as it is), then a style reference.
 */
export function buildFlyerImagePrompt(
  copy: FlyerCopyOutput,
  tokens: BrandTokens,
  aspect: FlyerAspect,
  hasReference: boolean,
  style?: FlyerStyleId,
  opts: { hasProduct?: boolean; quietZone?: FlyerQuietZone } = {},
): string {
  const c = tokens.colors;
  const palette = [c.primary, c.accent, c.secondary, c.background]
    .filter(Boolean)
    .join(", ");
  const quiet =
    opts.quietZone === "bottom"
      ? "Keep the lower 45% of the frame calm and uncluttered (soft background, no key subjects): a text panel goes there."
      : opts.quietZone === "top"
        ? "Keep the upper 40% of the frame calm and uncluttered (soft background, no key subjects): a text panel goes there."
        : "";

  const parts = [
    `Create the artwork for a social media post, ${FLYER_ASPECTS[aspect].label.toLowerCase()}.`,
    `Scene: ${copy.scene.trim().replace(/\.$/, "")}.`,
    // The uploaded reference IS the style; a preset direction would fight it.
    ...(style && !hasReference ? [FLYER_STYLE_DIRECTIONS[style]] : []),
    `Build the color mood around the brand palette: ${palette}.`,
    ...(opts.hasProduct
      ? [
          "The first attached image is the real product: show this exact product, unchanged (same shape, colors, label, and proportions), as the clear hero of the scene. Do not redesign it or add other products.",
        ]
      : []),
    ...(hasReference
      ? [
          `${opts.hasProduct ? "The last" : "An"} attached image is a style reference: match its visual style, color treatment, and mood, not its content.`,
        ]
      : []),
    quiet,
    "Absolutely no text anywhere: no words, letters, numbers, logos, signs, labels, captions, or watermarks (the product's own printed label is the only exception).",
    "Specific and crafted, never generic stock imagery: no handshakes, no people pointing at laptops, no lightbulbs.",
  ].filter(Boolean);

  return parts.join(" ");
}
