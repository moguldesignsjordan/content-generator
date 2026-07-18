import type { Anthropic } from "@anthropic-ai/sdk";
import type { EmailCopy, FlyerAspect, FlyerCopy, FlyerStyleId } from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import { FLYER_STYLE_CATALOG } from "@/lib/design-styles";

// Flyer prompt assembly: one FAST_MODEL call produces the flyer's copy AND a
// scene concept together (save_flyer_copy), then buildFlyerImagePrompt turns
// that into the render prompt. Unlike the hero-image scaffolds
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

/**
 * The "no one chose a style" default for flyers, mirroring
 * pickVariedImageStyle for hero images: a deterministic per-draft rotation so
 * consecutive flyers don't all come out of the same generic recipe. Only used
 * when there's no explicit preset AND no uploaded style reference.
 */
export function pickVariedFlyerStyle(seed?: string): FlyerStyleId {
  const pool = FLYER_STYLE_CATALOG.map((s) => s.id);
  if (!seed) return pool[Math.floor(Math.random() * pool.length)];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

/** What the copy call returns via forced tool use. */
export interface FlyerCopyOutput extends FlyerCopy {
  /** Visual concept for the background/imagery; never contains the text. */
  scene: string;
}

/** Forced tool: flyer copy + the visual scene concept, one cheap call. */
export const FLYER_COPY_TOOL: Anthropic.Tool = {
  name: "save_flyer_copy",
  description:
    "Return the flyer's copy and its visual concept. headline/subtext/cta are " +
    "typeset INTO the image exactly as written, so keep them short and " +
    "spell-checked. caption is the social post text that accompanies the " +
    "image. scene describes only the imagery/background, never the text.",
  input_schema: {
    type: "object",
    properties: {
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
    },
    required: ["headline", "caption", "scene"],
  },
};

/** Builds the (system, user) pair for the flyer copy + scene call. */
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
}): { system: string; user: string } {
  const system = [
    "You write copy for social media flyers (Instagram and Facebook post",
    "graphics). Given a topic and brand context, produce the flyer's on-image",
    "text, the post caption, and a visual concept. Rules:",
    "- headline: 8 words max, concrete benefit or hook, no clickbait.",
    "- subtext: one short line only when it adds something; otherwise omit.",
    "- cta: 2 to 4 words, action verb first.",
    "- caption: 1 to 3 sentences in the brand voice with a clear next step.",
    "- scene: imagery and composition only. Never describe the text, colors,",
    "  or fonts; the render prompt handles those.",
    "- NEVER use em dashes anywhere.",
    "Call save_flyer_copy once.",
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
    args.style
      ? `DESIGN DIRECTION (the scene you write must fit it): ${FLYER_STYLE_DIRECTIONS[args.style]}`
      : "",
    args.brief ? `CREATIVE BRIEF FROM THE USER (follow it): ${args.brief}` : "",
    ...emailLines,
    ...rejectionLines,
    "",
    "Call save_flyer_copy with the flyer copy, caption, and scene.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
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
