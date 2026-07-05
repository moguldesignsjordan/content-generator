import type { Anthropic } from "@anthropic-ai/sdk";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { HtmlPatch } from "@/lib/pipeline/html-edit";

// Single-shot WORDING edit for one region of an existing email draft: no new
// design, no new draft version, no thinking. The model reads the region's
// HTML and returns the small find/replace pair(s) that swap its visible text,
// preserving every tag, inline style, and the surrounding structure. Sibling
// to adjust-email-style (which edits looks); this edits words.
//
// Two modes:
//  - "edit": the user typed exact replacement text. Use it verbatim.
//  - "regenerate": rewrite the region's text in the same voice, optionally
//    guided by the user.
//
// Patch-based for the same reasons as style editing: the model only outputs
// the snippet that changes (cheap, fast), and find must match the current
// HTML verbatim, so it can't silently rewrite anything outside the named span.

export type CopyMode = "edit" | "regenerate";

export interface AdjustCopyRegionContext {
  /** The data-region value, e.g. "headline". */
  region: string;
  /** Plain-language label shown in the UI, e.g. "Headline". */
  label: string;
  /** The region element's outerHTML, copied verbatim from the live preview. */
  snippet: string;
}

export interface AdjustCopyToolInput {
  edits: HtmlPatch[];
  client_support_caveat?: string;
}

export const ADJUST_COPY_TOOL: Anthropic.Tool = {
  name: "save_copy_patch",
  description:
    "Return the small, exact find/replace edit(s) that swap the WORDING of " +
    "the named region. Do NOT return the whole document, only the minimal " +
    "snippet(s) whose text changes. Preserve every tag, inline style, " +
    "class, and attribute.",
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
                "Usually the visible text plus just enough of its wrapping " +
                "tag/style to be unmistakable. Never paste blocks you aren't " +
                "changing.",
            },
            replace: {
              type: "string",
              description:
                "What that exact substring becomes. Keep the SAME tags and " +
                "inline styles around the new text; only the human-visible " +
                "characters change.",
            },
            replace_all: {
              type: "boolean",
              description:
                "true ONLY if the same text genuinely appears multiple times " +
                "in this region and every instance should change. Omit " +
                "otherwise; a find matching more than once without this is " +
                "ambiguous and will be rejected.",
            },
          },
          required: ["find", "replace"],
        },
        description:
          "One entry per distinct text change. Most regions need exactly one.",
      },
      client_support_caveat: {
        type: "string",
        description:
          "One short sentence ONLY if the new text needs a technique some " +
          "email clients don't fully support. Omit entirely otherwise.",
      },
    },
    required: ["edits"],
  },
};

/** Builds the (system, user) pair for one copy-edit call. */
export function buildAdjustCopyMessages(args: {
  currentHtml: string;
  mode: CopyMode;
  /** Required for "edit" mode: the exact replacement text. */
  newText?: string;
  /** Optional for "regenerate" mode: guidance shaping the rewrite. */
  instruction?: string;
  tokens: BrandTokens;
  regionCtx: AdjustCopyRegionContext;
}): { system: string; user: string } {
  const { currentHtml, mode, newText, instruction, regionCtx } = args;

  const system = [
    "You are editing the WORDING of one part of an already-written marketing",
    "email. You change only the human-visible text. Every tag, inline style,",
    "class, attribute, image, link, and the surrounding structure stays",
    "exactly as it is.",
    "",
    "HOW TO WRITE EDITS:",
    "- Each find is copied EXACTLY from the CURRENT HTML below, same",
    "  whitespace, tags, and HTML entities, character for character.",
    "- Each replace keeps the SAME wrapping tags and inline styles and only",
    "  swaps the visible text characters inside them. Example, to change a",
    '  headline\'s words, an edit might be',
    '  find: `<h1 style="color:#0F172A;">Old headline</h1>`',
    '  replace: `<h1 style="color:#0F172A;">New headline</h1>`',
    "  The style attribute is untouched; only the text between the tags moved.",
    "- If the region contains inline formatting (a <strong>, an <a> link),",
    "  preserve that formatting on the equivalent words when it clearly maps;",
    "  otherwise drop it and use plain text in the same outer wrapper. Never",
    "  invent new links.",
    "- Stay inside the region the user clicked. Do not change any other part",
    "  of the email, including any other body block.",
    "- Do not change colors, fonts, sizes, spacing, layout, images, or the",
    "  unsubscribe footer. Do not add scripts or stylesheets.",
    "- Keep the hidden preheader div and every data-region attribute intact.",
    "",
    "VOICE: match the tone, register, and language of the surrounding copy.",
    "NEVER use em dashes (use commas, colons, or the word to instead).",
    "",
    "MODES:",
    '- "edit": the user supplied the exact replacement text. Use it VERBATIM',
    "  as the new visible text. Do not improve, shorten, lengthen, rephrase,",
    "  or fix it. Your only job is to drop their text into the region's",
    "  existing wrapper, preserving tags/styles.",
    '- "regenerate": rewrite the region\'s text freshly in the same voice,',
    "  keeping roughly the same length and structure. If the user gave",
    "  guidance, honor it. Keep it natural and on-brand.",
    "",
    "Call save_copy_patch once with the minimal edit(s) needed.",
  ].join("\n");

  const task =
    mode === "edit"
      ? [
          "MODE: edit. Replace this region's visible text with the following",
          "text, VERBATIM (keep the region's existing tags and inline styles,",
          "only the words change):",
          "",
          newText ?? "",
        ].join("\n")
      : [
          "MODE: regenerate. Rewrite this region's visible text in the same",
          "voice, keeping similar length and structure.",
          instruction ? `Guidance: ${instruction}` : "",
        ]
          .filter(Boolean)
          .join("\n");

  const user = [
    `The user clicked the "${regionCtx.label}" part of the email (data-region=` +
      `"${regionCtx.region}") to change its wording. Its current HTML is:`,
    regionCtx.snippet,
    "",
    task,
    "",
    "CURRENT HTML (whole document, for context only; change ONLY the named region):",
    currentHtml,
    "",
    "Call save_copy_patch with the minimal exact find/replace edit(s) that",
    "swap this region's text and nothing else.",
  ].join("\n");

  return { system, user };
}
