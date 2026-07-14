import type { Anthropic } from "@anthropic-ai/sdk";
import type { Brand, Icp } from "@/lib/db/types";
import { buildBrandVoiceBlock } from "./brand-voice";

// PROPOSE-ONLY rewrite of one section's text. The important difference from
// adjust-copy.ts: this asks for TEXT, not for HTML patches, and it commits
// nothing.
//
// Why that matters. The old "Rewrite it for me" handed the model the email's
// markup and let it return find/replace pairs whose `replace` side was
// arbitrary HTML. The only gate on the way back in was a length-and-<body>
// check, so a rewrite that mangled a table or dropped inline styles was
// persisted silently. That is one of the ways the email UI got broken.
//
// Here the model returns plain text (light markdown for blog bodies). The
// caller shows it to the user, and if they accept it, it is placed into the
// section through the exact same deterministic path as text they typed
// themselves. The model is structurally incapable of touching the markup.
//
// Channel-agnostic on purpose: an email region and a blog field are both
// "some words in a brand's voice", so one prompt serves both and the two
// review screens keep behaving identically (the review UI is shared).

export interface RewriteToolInput {
  text: string;
}

export const REWRITE_REGION_TOOL: Anthropic.Tool = {
  name: "save_rewritten_text",
  description:
    "Return the rewritten visible TEXT for the section. Plain text only, no " +
    "HTML tags, no wrapping quotes, no commentary.",
  input_schema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "The new text for this section. Plain text. Preserve paragraph " +
          "breaks as blank lines when the original had several paragraphs. " +
          "Never include HTML tags.",
      },
    },
    required: ["text"],
  },
};

/** Builds the (system, user) pair for one propose-only rewrite. */
export function buildRewriteMessages(args: {
  brand: Brand;
  icp: Icp | null;
  /** "email" or "blog" — only shapes the register, not the output format. */
  channel: "email" | "blog";
  /** Plain-language label of the clicked section, e.g. "Headline". */
  label: string;
  /** The section's current visible text. */
  currentText: string;
  /** Optional user guidance, e.g. "make it punchier". */
  instruction?: string;
  /** Whether light markdown (**bold**, links, bullets) is meaningful here. */
  allowMarkdown: boolean;
}): { system: string; user: string } {
  const { brand, icp, channel, label, currentText, instruction, allowMarkdown } = args;

  const system = [
    buildBrandVoiceBlock(brand, icp, channel),
    "",
    `You are rewriting ONE section (the "${label}") of an existing ${channel}.`,
    "",
    "RULES:",
    "- Return TEXT, never HTML. No tags, no attributes, no styling.",
    "- Keep roughly the same length and structure as the current text. A",
    "  headline stays a headline; a three-paragraph body stays three",
    "  paragraphs (separated by blank lines).",
    "- Match the brand voice above. Do not drift into generic marketing filler.",
    "- Do not invent facts, statistics, product names, prices, or claims that",
    "  are not already present in the current text.",
    "- NEVER use em dashes or en dashes. Use commas, colons, or the word to.",
    allowMarkdown
      ? "- Light markdown is allowed and encouraged where it already fits: **bold**, *italic*, - bullets, [text](url). Do not add links that were not already there."
      : "- No markdown syntax. This section renders as plain words.",
    "",
    "Call save_rewritten_text once with the new text.",
  ].join("\n");

  const user = [
    `Section: ${label}`,
    "",
    "Its current text is:",
    currentText,
    "",
    instruction
      ? `The user asked for this specifically: ${instruction}`
      : "The user asked for a fresh take on it, no specific guidance.",
    "",
    "Call save_rewritten_text with the rewritten text.",
  ].join("\n");

  return { system, user };
}
