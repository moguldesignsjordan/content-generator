import type { Anthropic } from "@anthropic-ai/sdk";
import type { EmailCopy, FlyerAspect, FlyerCopy, FlyerStyleId } from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import { FLYER_STYLE_CATALOG } from "@/lib/design-styles";
import { stripEmDashes, stripMarkdown } from "@/lib/text";

// Flyer prompt assembly: one FAST_MODEL call produces several alternative
// flyers, each with its copy AND a scene concept (save_flyer_variants), then
// buildFlyerImagePrompt turns each into a render prompt. Unlike the hero-image scaffolds
// (prompts/generate-image.ts), which forbid text, a flyer is a DESIGNED
// GRAPHIC: the render prompt passes the exact headline/subtext/CTA strings for
// the image model to typeset, plus the brand palette and font direction.

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
    "Style direction: a bold typographic poster. The headline is the hero at " +
    "massive scale, high-contrast solid color blocks, minimal supporting " +
    "imagery, a confident grid.",
  minimal:
    "Style direction: sleek and minimal. Generous empty space, one small " +
    "focal element, restrained palette, hairline details, quiet premium feel.",
  photo_backdrop:
    "Style direction: a full-bleed photographic backdrop drawn from the scene, " +
    "with a subtle dark or light overlay so every word stays highly legible.",
  illustrated:
    "Style direction: flat vector illustration. Friendly geometric shapes, " +
    "clean edges, generous negative space around the text.",
  collage:
    "Style direction: an editorial paper-cutout collage. Layered elements " +
    "with subtle real shadows, tactile, magazine-cover energy.",
  retro_print:
    "Style direction: a vintage screen-print poster. Bold simplified shapes, " +
    "slightly misregistered ink layers, subtle halftone grain and paper texture.",
  gradient_glow:
    "Style direction: smooth flowing brand-color gradients with a soft glow, " +
    "modern tech-launch energy, crisp type floating on top.",
  elegant:
    "Style direction: premium and elegant. Refined serif-led typography, " +
    "luxurious spacing, delicate rules and details, understated color.",
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

/** Forced tool: several complete alternative flyers in one cheap call. */
export const FLYER_VARIANTS_TOOL: Anthropic.Tool = {
  name: "save_flyer_variants",
  description:
    "Return several alternative flyers for the same topic. Each one is " +
    "complete: its own headline/subtext/cta (typeset INTO the image exactly " +
    "as written), caption, hashtags, and scene. Make them genuinely different " +
    "hooks, not rewordings of one idea.",
  input_schema: {
    type: "object",
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: FLYER_COPY_PROPERTIES,
          required: FLYER_COPY_REQUIRED,
        },
      },
    },
    required: ["variants"],
  },
};

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
  const system = [
    "You write copy for social media flyers (Instagram and Facebook post",
    "graphics). Given a topic and brand context, produce alternative flyers,",
    "each with its own on-image text, post caption, and visual concept. Rules:",
    "- headline: 8 words max, concrete benefit or hook, no clickbait.",
    "- subtext: one short line only when it adds something; otherwise omit.",
    "- cta: 2 to 4 words, action verb first.",
    "- caption: 1 to 3 sentences in the brand voice with a clear next step.",
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
    ...rejectionLines,
    "",
    `Call save_flyer_variants with ${variants.count} complete variants.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

/** Em-dash stripping + trimming across every text field, like the other pipelines. */
export function cleanFlyerCopy(out: FlyerCopyOutput): FlyerCopyOutput {
  // Flyer copy is painted onto an image and posted as a caption: markdown the
  // model slipped in would render as literal asterisks either way.
  const plain = (text: string) => stripMarkdown(stripEmDashes(text));
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
export function parseFlyerVariants(input: unknown, count: number): FlyerCopyOutput[] {
  const raw = (input as { variants?: unknown } | null)?.variants;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is FlyerCopyOutput => {
      const c = v as Partial<FlyerCopyOutput> | null;
      return Boolean(c?.headline?.trim() && c.caption?.trim() && c.scene?.trim());
    })
    .slice(0, count)
    .map(cleanFlyerCopy);
}

/**
 * Builds the final render prompt: exact text to typeset, brand palette and
 * font direction, the scene, and (optionally) the style-reference directive.
 */
export function buildFlyerImagePrompt(
  copy: FlyerCopyOutput,
  tokens: BrandTokens,
  aspect: FlyerAspect,
  hasReference: boolean,
  style?: FlyerStyleId,
): string {
  const c = tokens.colors;
  const palette = [c.primary, c.accent, c.secondary, c.background]
    .filter(Boolean)
    .join(", ");

  const textLines = [
    `the headline "${copy.headline}"`,
    copy.subtext ? `the supporting line "${copy.subtext}"` : "",
    copy.cta ? `a call-to-action button or banner reading "${copy.cta}"` : "",
  ].filter(Boolean);

  const parts = [
    `Design a polished social media flyer, ${FLYER_ASPECTS[aspect].label.toLowerCase()}.`,
    `Typeset EXACTLY this text and nothing else: ${textLines.join(", ")}.`,
    "Every word spelled exactly as given, no extra words, labels, or filler text.",
    "Strong typographic hierarchy: headline dominant, supporting text clearly smaller.",
    `Brand palette (use these colors for backgrounds, accents, and the CTA): ${palette}.`,
    `Typography in the spirit of ${tokens.fonts.heading} for headings and ${tokens.fonts.body} for supporting text.`,
    `Imagery and composition: ${copy.scene.trim().replace(/\.$/, "")}.`,
    // The uploaded reference IS the style; a preset direction would fight it.
    ...(style && !hasReference ? [FLYER_STYLE_DIRECTIONS[style]] : []),
    "Clean margins, high contrast between text and background, professional agency quality.",
    "No watermarks, no logos, no borders, no fake UI.",
  ];

  if (hasReference) {
    parts.push(
      "A reference image is attached: match its visual style, layout language, " +
        "color treatment, and mood, but keep the text content exactly as " +
        "specified above.",
    );
  }

  return parts.join(" ");
}
