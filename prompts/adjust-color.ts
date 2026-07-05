import type { Anthropic } from "@anthropic-ai/sdk";
import type { HtmlPatch } from "@/lib/pipeline/html-edit";

// Single-shot COLOR edit for one region of an existing email draft: the user
// clicked a region and picked an exact hex color. No new design, no new
// draft version, no thinking, no free-text ambiguity (the target color is
// given, not described). Sibling to adjust-copy (words) and adjust-style
// (open-ended looks); this one just needs the model to find the right
// property to recolor within the region's own snippet and swap its hex.
//
// Patch-based for the same reasons as the other two: the model only outputs
// the small snippet(s) that change, and find must match the current HTML
// verbatim, so it can't touch anything outside the named region.

export interface AdjustColorRegionContext {
  /** The data-region value, e.g. "cta". */
  region: string;
  /** Plain-language label shown in the UI, e.g. "Call to action". */
  label: string;
  /** The region element's outerHTML, copied verbatim from the live preview. */
  snippet: string;
}

export interface AdjustColorToolInput {
  edits: HtmlPatch[];
  client_support_caveat?: string;
}

export const ADJUST_COLOR_TOOL: Anthropic.Tool = {
  name: "save_color_patch",
  description:
    "Return the small, exact find/replace edit(s) that recolor the named " +
    "region to the given hex color. Do NOT return the whole document, only " +
    "the minimal snippet(s) whose color changes. Preserve every tag, " +
    "wording, class, and non-color attribute.",
  input_schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            find: {
              type: "string",
              description:
                "An EXACT, VERBATIM substring copied from the region's " +
                "current HTML (same whitespace, tags, entities, everything). " +
                "Usually one style attribute's value plus just enough of the " +
                "surrounding tag to be unmistakable. Never paste blocks you " +
                "aren't changing.",
            },
            replace: {
              type: "string",
              description:
                "The same substring with only the color value(s) swapped to " +
                "the target hex. Every other character stays identical.",
            },
            replace_all: {
              type: "boolean",
              description:
                "true ONLY if the exact same color property/value genuinely " +
                "appears multiple times in this region and every instance " +
                "should change. Omit otherwise.",
            },
          },
          required: ["find", "replace"],
        },
        description:
          "One entry per distinct color property that changes. Most regions " +
          "need exactly one (e.g. a button's background-color, or a " +
          "headline's text color).",
      },
      client_support_caveat: {
        type: "string",
        description:
          "One short sentence ONLY if the new color creates a real contrast " +
          "or legibility problem (e.g. light text picked against an already " +
          "light background). Omit entirely otherwise.",
      },
    },
    required: ["edits"],
  },
};

/** Builds the (system, user) pair for one color-edit call. */
export function buildAdjustColorMessages(args: {
  currentHtml: string;
  hex: string;
  regionCtx: AdjustColorRegionContext;
}): { system: string; user: string } {
  const { currentHtml, hex, regionCtx } = args;

  const system = [
    "You are recoloring ONE visually distinct part of an already-designed",
    "marketing email. The user picked an exact target color; your only job",
    "is finding which color property makes that region look that color, and",
    "swapping its hex value. You do not invent a color or judge the choice.",
    "",
    "HOW TO DECIDE WHICH PROPERTY:",
    "- If the region is a button or has a filled background (a colored bar,",
    "  the CTA, an eyebrow pill), recolor its background-color (or",
    "  background/background-color shorthand). Leave the text color alone",
    "  unless the new background would make the existing text unreadable",
    "  (very low contrast), in which case also flip the text to a safe",
    "  contrasting color (near-white on a dark target, near-black on a light",
    "  target) and mention it in client_support_caveat.",
    "- If the region is plain text with no fill (a headline, body copy, an",
    "  eyebrow label with no background, a footer line), recolor the text",
    "  color property (color:, or a CSS variable/class if that's how it's",
    "  styled).",
    "- If a link/anchor's color is the visually dominant thing in the region,",
    "  recolor that.",
    "- Only recolor properties that visibly change how this region reads.",
    "  Do not touch borders, shadows, or decorative accents unless they are",
    "  clearly the ONLY colored element in an otherwise neutral region.",
    "",
    "HOW TO WRITE EDITS:",
    "- Each find is copied EXACTLY from the CURRENT HTML below, same",
    "  whitespace, tags, and HTML entities, character for character.",
    "- Each replace is identical except the color value(s) become the exact",
    "  target hex given. Do not change wording, tags, classes, spacing, or",
    "  any other attribute.",
    "- Stay inside the region the user clicked. Do not change any other part",
    "  of the email, including any other body block.",
    "- Do not add scripts or stylesheets. Keep the hidden preheader div and",
    "  every data-region attribute intact.",
    "",
    "Call save_color_patch once with the minimal edit(s) needed.",
  ].join("\n");

  const user = [
    `The user clicked the "${regionCtx.label}" part of the email (data-region=` +
      `"${regionCtx.region}") and picked the color ${hex}. Its current HTML is:`,
    regionCtx.snippet,
    "",
    `Target color: ${hex}`,
    "",
    "CURRENT HTML (whole document, for context only; change ONLY the named region):",
    currentHtml,
    "",
    "Call save_color_patch with the minimal exact find/replace edit(s) that",
    `recolor this region to ${hex} and nothing else.`,
  ].join("\n");

  return { system, user };
}
