import type { Anthropic } from "@anthropic-ai/sdk";
import {
  AD_CTA_BUTTONS,
  type AdCopy,
  type AdCtaButton,
  type CompetitorReference,
  type DesignLookProfile,
  type EmailCopy,
  type FlyerAspect,
  type FlyerCopy,
  type FlyerExtra,
  type FlyerFormat,
  type FlyerStyleId,
} from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import { FLYER_STYLE_CATALOG } from "@/lib/design-styles";
import { buildCompetitorReferenceBlock } from "./brand-voice";
import { AI_TELL_WRITER_RULES } from "./ai-tells";
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
  opts: { fixedStyle?: FlyerStyleId; hasReference: boolean; count?: number },
): (FlyerStyleId | undefined)[] {
  const count = opts.count ?? FLYER_VARIANT_COUNT;
  if (opts.hasReference) return Array(count).fill(undefined);
  if (opts.fixedStyle) return Array(count).fill(opts.fixedStyle);
  return pickFlyerStyleSet(seed, count);
}

/** What the copy call returns via forced tool use. */
export interface FlyerCopyOutput extends FlyerCopy {
  /** Visual concept for the background/imagery; never contains the text. */
  scene: string;
  /** The owner's photos this option shows, by number (1-based). */
  photos?: number[];
}

/** Only offered when the owner's photos are attached to the copy call. */
const PHOTOS_PROPERTY = {
  photos: {
    type: "array",
    items: { type: "integer" },
    description:
      "The numbers of the PRODUCT PHOTOS this variant shows (1, 2, ...): one, " +
      "or several together when it's about more than one product.",
  },
};

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
  mockup: {
    type: "array",
    items: { type: "string" },
    description:
      "Only when the picture shows off a designed item this brand makes or " +
      "sells (a sign, business card, banner, door hanger, packaging, a " +
      "screen): 1 to 3 short lines of made-up sample text printed on that " +
      "item, e.g. a fictional business name, a short tagline, and a phone " +
      "number in the 555-01XX range. Never a real business. Omit otherwise.",
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

/** Only offered when the look has extra text spots to fill. */
const EXTRAS_PROPERTY = {
  extras: {
    type: "array",
    description:
      "Text for the design's EXTRA TEXT SPOTS, one entry per spot you can " +
      "fill truthfully, typeset into the image exactly as written. Leave a " +
      "spot out when the brief has nothing real for it. Only the words to " +
      "print, never how they're styled. Never use em dashes.",
    items: {
      type: "object",
      properties: {
        slot: { type: "string", description: "The spot, copied exactly from the EXTRA TEXT SPOTS list." },
        text: { type: "string", description: "Short text for it, sized to the spot." },
      },
      required: ["slot", "text"],
    },
  },
};

/** Cap per extra line: a spot is a tagline or a pill, not a paragraph. */
const MAX_EXTRA_CHARS = 90;

/** Forced tool: several complete alternative flyers in one cheap call. */
export function flyerVariantsTool(
  format: FlyerFormat = "post",
  withExtras = false,
  withPhotos = false,
): Anthropic.Tool {
  const ad = format === "ad";
  const properties = {
    ...(ad ? AD_PROPERTIES : FLYER_COPY_PROPERTIES),
    ...(withExtras ? EXTRAS_PROPERTY : {}),
    ...(withPhotos ? PHOTOS_PROPERTY : {}),
  };
  const required = [...(ad ? AD_REQUIRED : FLYER_COPY_REQUIRED), ...(withPhotos ? ["photos"] : [])];
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
            properties,
            required,
          },
        },
      },
      required: ["variants"],
    },
  };
}

/** "https://www.example.com/" → "example.com": how a flyer prints a site. */
export function displayDomain(url: string): string {
  return url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

/** Builds the (system, user) pair for the flyer variants call. */
export function buildFlyerCopyMessages(args: {
  brandName: string;
  /** The shared brand context (buildBrandContext), the same every writer gets. */
  brandContext: string;
  topicTitle: string;
  aspect: FlyerAspect;
  /** The brand's real site, so a website spot never gets a guessed domain. */
  website?: string;
  /** Freeform creative brief typed at creation time, if any. */
  brief?: string;
  /** The chat's structured brief (buildCampaignBriefBlock for social), the
   * same block the email and blog writers read. */
  briefBlock?: string;
  /** The design-direction preset, so the scene the model writes fits it
   * (e.g. minimal wants one element, photo_backdrop wants a real setting). */
  style?: FlyerStyleId;
  /** When the flyer is spun off an email draft: distill this email's offer. */
  emailCopy?: EmailCopy;
  /** A saved competitor ad to learn the approach (and some phrasing) from. */
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
  /** The look's extra text spots (DesignLookProfile.text_slots). */
  textSlots?: string[];
  /** How many of the owner's photos ride ahead of the user text as images. */
  photoCount?: number;
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
    "- facts: every price, original price, discount, turnaround time, shipping",
    "  or setup promise, guarantee, count, and stat in any field (mockup aside)",
    "  must come from the brief or the brand context, and only for what it",
    "  describes: never invent one, and never borrow a number from another",
    "  service. Without a real fact, sell the benefit without a number.",
    "- scene: imagery and composition only. Never describe the text, colors,",
    "  or fonts; the render prompt handles those.",
    "- mockup: only when the scene shows off a designed item the brand makes",
    "  or sells, so it looks finished instead of blank. A made-up business",
    "  that fits the item, never a real one; phone numbers in 555-01XX.",
    "- NEVER use em dashes anywhere.",
    ...AI_TELL_WRITER_RULES,
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
        "in this brand's voice. At least two variants follow the reference's hook type",
        "and structure; the rest may try something else. A layout idea may",
        "shape a scene, but never recreate the competitor's products, people,",
        "or imagery.",
      ]
    : [];

  const slotLines = args.textSlots?.length
    ? [
        "",
        "EXTRA TEXT SPOTS: the design this flyer follows also has these text",
        "elements. For each variant, fill each one in extras with short text",
        "built ONLY from real facts in the brief (dates, times, places, the",
        "offer, real values). Leave a spot out when the brief has nothing true",
        "for it: an empty spot is dropped from the design, invented text isn't.",
        "That includes a spot that needs a missing fact, like an original price",
        "to strike through or a stat for a badge. Each text is exactly the words",
        "printed, never a description of how they look (no 'crossed out',",
        "'in a badge', 'with checkmarks'): the design draws that part.",
        ...args.textSlots.map((slot) => `  - ${slot}`),
      ]
    : [];

  const photoCount = args.photoCount ?? 0;
  const photoLines = photoCount
    ? [
        "",
        `PRODUCT PHOTOS: the ${photoCount === 1 ? "image above is a real photo" : `${photoCount} images above are real photos`} of the owner's products, numbered 1 to ${photoCount} in order. Look at each one.`,
        "For each variant, set photos to the ones it shows (one, or several together",
        "when it's about more than one product), and write its scene around exactly",
        "those products as they look. Never invent a product or show one that isn't",
        "in the photos, and give a photographed product no mockup text: it keeps its",
        "own printed design.",
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
    args.brandContext,
    "",
    `FLYER TOPIC: ${args.topicTitle}`,
    `FLYER SHAPE: ${FLYER_ASPECTS[args.aspect].label}`,
    args.website
      ? `WEBSITE (write it exactly like this wherever a website goes, never any other address): ${displayDomain(args.website)}`
      : "",
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
    args.briefBlock ? `\n${args.briefBlock}` : "",
    ...emailLines,
    ...competitorLines,
    ...slotLines,
    ...photoLines,
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
    ...cleanExtras(out.extras),
    ...cleanMockup(out.mockup),
    ...cleanPhotoNumbers(out.photos),
  };
}

/** Whole, positive, unique photo numbers; the pipeline maps them to photos. */
function cleanPhotoNumbers(raw: unknown): { photos?: number[] } {
  if (!Array.isArray(raw)) return {};
  const numbers = Array.from(
    new Set(raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1)),
  );
  return numbers.length ? { photos: numbers } : {};
}

/** Cap per mockup line: a name, a tagline, or a phone number. */
const MAX_MOCKUP_CHARS = 40;

function cleanMockup(raw: unknown): { mockup?: string[] } {
  if (!Array.isArray(raw)) return {};
  const lines = raw
    .filter((l): l is string => typeof l === "string")
    .map((l) => plain(l.trim()))
    .filter((l) => l && l.length <= MAX_MOCKUP_CHARS)
    .slice(0, 3);
  return lines.length ? { mockup: lines } : {};
}

/** Keeps extras with a slot and short text, deduped by slot. */
function cleanExtras(raw: unknown): { extras?: FlyerExtra[] } {
  if (!Array.isArray(raw)) return {};
  const seen = new Set<string>();
  const extras: FlyerExtra[] = [];
  for (const item of raw.slice(0, 4)) {
    const e = item as Partial<FlyerExtra> | null;
    const slot = typeof e?.slot === "string" ? e.slot.trim() : "";
    const text = typeof e?.text === "string" ? plain(e.text.trim()) : "";
    if (!slot || !text || text.length > MAX_EXTRA_CHARS || seen.has(slot)) continue;
    seen.add(slot);
    extras.push({ slot, text });
  }
  return extras.length ? { extras } : {};
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
          extras: c.extras,
          mockup: c.mockup,
          photos: c.photos,
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
 * doesn't. Reference images, when attached, come in this order: the owner's
 * product photos (kept exactly as they are), then a style reference.
 */
export function buildFlyerImagePrompt(
  copy: FlyerCopyOutput,
  tokens: BrandTokens,
  aspect: FlyerAspect,
  hasReference: boolean,
  style?: FlyerStyleId,
  opts: { photoCount?: number; quietZone?: FlyerQuietZone } = {},
): string {
  const photos = opts.photoCount ?? 0;
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
    ...(photos === 1
      ? [
          "The first attached image is the real product: show this exact product, unchanged (same shape, colors, label, printed design, and proportions), as the clear hero of the scene. Do not redesign it or add other products.",
        ]
      : photos > 1
        ? [
            `The first ${photos} attached images are the real products: show each one exactly as photographed, unchanged (same shape, colors, label, printed design, and proportions), arranged together as the heroes of the scene. Do not redesign them or add other products.`,
          ]
        : []),
    ...(hasReference
      ? [
          `${photos ? "The last" : "An"} attached image is a style reference: match its visual style, color treatment, and mood, not its content.`,
        ]
      : []),
    quiet,
    "Absolutely no text anywhere: no words, letters, numbers, logos, signs, labels, captions, or watermarks (the product's own printed label is the only exception).",
    "Specific and crafted, never generic stock imagery: no handshakes, no people pointing at laptops, no lightbulbs.",
  ].filter(Boolean);

  return parts.join(" ");
}

/** What each option of a flyer matching attached designs does differently:
 * the first stays close, the rest keep the style and change the composition,
 * so the owner gets a real choice instead of four near-copies. */
export const DESIGN_RIFFS = [
  "This is option 1: stay as close to the examples' layout, composition, and type treatment as you can, with this piece's own content.",
  "This is a variation: keep the examples' style, type, and colors, but recompose it, with the headline in a different part of the frame at a different scale.",
  "This is a variation: keep the examples' style, type, and colors, but build the design around a different main visual element for this subject.",
  "This is a variation: keep the examples' style and type, but lead with the accent color as a large, confident color block or shape.",
] as const;

/**
 * Builds the render prompt for a flyer that follows a design look: the image
 * model designs the WHOLE flyer, text included, matching the attached
 * examples. The text it sets is read back and checked (lib/flyer/text-check.ts)
 * before anyone sees it. References arrive in this order, and the prompt
 * numbers each one by its job: the owner's product photos (photoCount), the
 * look's examples, then the client's logo (when client.hasLogo).
 */
export function buildFlyerDesignPrompt(
  copy: FlyerCopyOutput,
  tokens: BrandTokens,
  aspect: FlyerAspect,
  look: {
    profile: DesignLookProfile | null;
    /** 0 designs from `style` alone (No reference). */
    exampleCount: number;
    roles: { background: string; text: string; accent: string };
    style?: FlyerStyleId;
  },
  opts: {
    /** The owner's product photos sent first, shown exactly as they look. */
    photoCount?: number;
    misspelled?: string[];
    /** Where the logo goes. Stamped afterwards for the brand (the corner is
     * kept clear); drawn from its reference image for a client. */
    logoCorner?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | null;
    /** Index into DESIGN_RIFFS; unset keeps every option a close match. */
    riff?: number;
    /** The flyer is for this business, not the brand. */
    client?: { name: string; hasLogo: boolean; hasColors: boolean };
  } = {},
): string {
  const p = look.profile;
  const showCta = Boolean(copy.cta) && p?.cta_style !== "none";
  const owner = opts.client
    ? opts.client.name.endsWith("s") ? `${opts.client.name}'` : `${opts.client.name}'s`
    : "";

  // Number the references in send order so each one has a clear job.
  const photos = opts.photoCount ?? 0;
  let n = photos;
  const photoRange = photos === 1 ? "Image 1" : `Images 1 to ${photos}`;
  const firstExample = n + 1;
  n += look.exampleCount;
  const hasExamples = look.exampleCount > 0;
  const exampleRange =
    look.exampleCount === 1 ? `Image ${firstExample} is` : `Images ${firstExample} to ${n} are`;
  const logoImage = opts.client?.hasLogo ? ++n : null;
  const roles = [
    photos === 1 ? "Image 1 is a real photo of the owner's product." : "",
    photos > 1 ? `${photoRange} are real photos of the owner's products.` : "",
    hasExamples ? `${exampleRange} the design ${look.exampleCount === 1 ? "example" : "examples"} to match.` : "",
    logoImage ? `Image ${logoImage} shows ${owner} logo.` : "",
  ].filter(Boolean);

  const font = tokens.fonts.heading.split(",")[0].replace(/['"]/g, "").trim();
  const headlineType = opts.client && hasExamples
    ? "in the examples' headline type treatment"
    : `${p ? `${p.headline_treatment}, ` : ""}in the spirit of ${font || "a bold modern sans serif"}`;
  const lines = [
    `Headline: "${copy.headline}", ${headlineType}.`,
    copy.subtext ? `Supporting line: "${copy.subtext}", smaller and quieter than the headline.` : "",
    ...(copy.extras ?? []).map((e) => `${e.slot.charAt(0).toUpperCase()}${e.slot.slice(1).replace(/\.$/, "")}: "${e.text}".`),
    showCta ? `Call to action: "${copy.cta}"${p ? `, styled as a ${p.cta_style}` : ""}.` : "",
  ].filter(Boolean);

  const colors =
    opts.client && !opts.client.hasColors
      ? logoImage
        ? `Colors: take ${owner} colors from their logo (Image ${logoImage}) and use them in the roles the examples use.`
        : `Colors: a restrained palette of ${look.roles.background} and ${look.roles.text}, with ${look.roles.accent} as the one accent.`
      : `Colors: use ${opts.client ? owner : "the brand's"} colors${hasExamples ? " in the roles the examples use" : ""}. Main background or dominant color ${look.roles.background}, text ${look.roles.text}, and ${look.roles.accent} as the one accent${p ? ` (${p.color_roles.accent_usage})` : ""}.`;

  const logo = logoImage
    ? `Reproduce ${owner} logo from Image ${logoImage} exactly (same letters, colors, and shapes), cleanly and at a readable size, ${opts.logoCorner ? `in the ${opts.logoCorner} corner` : "where the examples place a logo"}. It is the only logo on the flyer.`
    : opts.client
      ? "The flyer carries no logo."
      : opts.logoCorner
        ? `Keep the ${opts.logoCorner} corner completely empty of text and key subjects: the brand logo is added there afterwards.`
        : "";

  const mockup = copy.mockup?.length
    ? `The item this piece shows off carries its own finished sample design, with exactly this text printed on it and nothing else: ${copy.mockup.map((m) => `"${m}"`).join(", ")}.`
    : "";
  const design = hasExamples
    ? [
        `Use Image${look.exampleCount === 1 ? ` ${firstExample}` : `s ${firstExample} to ${firstExample + look.exampleCount - 1}`} as the design to follow: match its layout, typographic treatment, color use, composition, density, and overall feel as closely as possible, and fill it with entirely new content: a new background, new imagery, and none of its photos, people, objects, or words. Everything below adapts that design to this message.`,
      ]
    : [
        "Design it the way a top agency art director would: one bold idea, a clear hierarchy with the headline dominant, confident type, and generous breathing room.",
        ...(look.style ? [FLYER_STYLE_DIRECTIONS[look.style]] : []),
      ];

  return [
    `Design a finished, professional social media ${opts.client ? "flyer" : "ad"}, ${FLYER_ASPECTS[aspect].label.toLowerCase()}${opts.client ? `, for ${opts.client.name}` : ""}.`,
    "The image IS the flyer, filling the entire frame edge to edge: not a photo or mockup of a flyer, with no border or backdrop around it.",
    roles.join(" "),
    ...design,
    ...(p
      ? [
          `The look: ${p.summary} Layout: ${p.layout}. Text: ${p.text_placement}. Imagery: ${p.imagery}. Mood: ${p.mood.join(", ")}.`,
        ]
      : []),
    ...(opts.riff !== undefined && hasExamples ? [DESIGN_RIFFS[opts.riff % DESIGN_RIFFS.length]] : []),
    `Subject for this piece${hasExamples ? ", shown the way the examples show theirs" : ""}: ${copy.scene.trim().replace(/\.$/, "")}.`,
    mockup,
    `On the flyer itself, typeset EXACTLY these lines and no other words, every word spelled exactly as given. ${lines.join(" ")}`,
    hasExamples ? "Any other text element the examples have (taglines, footers, lists, labels) is left out of this design entirely." : "",
    ...(opts.misspelled?.length
      ? [`A previous attempt got this text wrong: ${opts.misspelled.map((m) => `"${m}"`).join(", ")}. Spell it exactly.`]
      : []),
    colors,
    ...(photos === 1
      ? [
          "Show the product from Image 1 exactly as photographed (same shape, colors, label, printed design, and proportions).",
        ]
      : photos > 1
        ? [
            `Show every product from ${photoRange} exactly as photographed (same shape, colors, label, printed design, and proportions), arranged together as the heroes of the scene.`,
          ]
        : []),
    logo,
    hasExamples
      ? "The examples are style references only. Never copy their words, logos, brand names, products, or people, and never reuse their photos, backgrounds, or decorative objects: draw all imagery new."
      : "",
    mockup
      ? "Every other printed item, screen, sign, and package in the scene stays blank. No watermarks and no placeholder text anywhere else."
      : "Printed items, screens, signs, and packaging in the scene stay blank (only a real product photo keeps its own label). No watermarks and no placeholder text anywhere.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * "Put it in the design": an edit of the finished flyer (first reference)
 * that brings in the owner's image (second reference), keeping everything
 * else. `note` is the owner's own placement instruction.
 */
export function buildPlaceImagePrompt(
  aspect: FlyerAspect,
  opts: { note?: string; misspelled?: string[] } = {},
): string {
  const note = opts.note ? stripEmDashes(opts.note).trim().replace(/\.$/, "") : "";
  return [
    `Edit the first attached image, a finished ${FLYER_ASPECTS[aspect].label.toLowerCase()} design.`,
    `Bring the subject of the second attached image into this design: ${note || "place it where it suits the composition best, large enough to read clearly"}.`,
    "Keep that subject true to the photo: the same person, product, or object, with the same face, shape, colors, and any printed label. Not a lookalike.",
    "Keep everything else as it is: the layout, background, colors, logo, and every word of text, spelled exactly as it is now and in the same place. Change only what's needed to make room for the new subject, and match its lighting to the design.",    ...(opts.misspelled?.length
      ? [`A previous attempt changed this text: ${opts.misspelled.map((m) => `"${m}"`).join(", ")}. Keep it exactly as in the first image.`]
      : []),
    "Add no new words, watermarks, or placeholder text.",
  ].join(" ");
}
