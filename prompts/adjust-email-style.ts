import type { Anthropic } from "@anthropic-ai/sdk";
import type { BrandTokens } from "@/lib/email/templates/types";

// Lightweight, single-shot style editing for an EXISTING email draft: no new
// copy, no new draft version, no thinking, just "take this HTML and this
// instruction and return the edited HTML." Deliberately NOT an agent (no
// planning/critique loop, no multi-step tool use): one cheap call, same
// discipline the generation pipeline already trusts for HTML output
// (validateModelEmailHtml + ensureUnsubscribeTag guard whatever comes back).

export interface AdjustStyleToolInput {
  html: string;
}

export const ADJUST_STYLE_TOOL: Anthropic.Tool = {
  name: "save_adjusted_email",
  description:
    "Return the complete edited HTML document with the requested style " +
    "change applied and everything else preserved exactly.",
  input_schema: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description:
          "The complete HTML document (doctype through </html>), identical " +
          "to the input except for the requested change.",
      },
    },
    required: ["html"],
  },
};

/** Builds the (system, user) pair for one style-adjustment call. */
export function buildAdjustStyleMessages(args: {
  currentHtml: string;
  instruction: string;
  tokens: BrandTokens;
}): { system: string; user: string } {
  const { currentHtml, instruction, tokens } = args;
  const c = tokens.colors;
  const f = tokens.fonts;

  const system = [
    "You are editing the HTML of an already-written marketing email. You",
    "make ONLY the visual/style change the user asks for. This is a styling",
    "edit, not a rewrite.",
    "",
    "RULES:",
    "- Do not change any copy, wording, subject matter, or text content.",
    "  Do not add, remove, or reorder sections unless explicitly asked.",
    "- Keep the same overall structure: nested <table role=\"presentation\">",
    "  layout (Outlook-safe, no CSS grid/flexbox/floats/position), the hidden",
    "  preheader div, the 600px card, all inline styles. Only touch what the",
    "  instruction targets.",
    "- ALL styles stay inline on elements (email HTML is not browser HTML).",
    "  No external stylesheets, no <link>, no JavaScript.",
    "- If asked for a gradient background, set a solid background-color",
    "  fallback (for clients that ignore CSS gradients) AND a",
    "  background: linear-gradient(...) on the same element.",
    "- Keep the footer unsubscribe link exactly as {$unsubscribe}, do not",
    "  alter or remove it.",
    "- If the instruction doesn't specify colors, use the brand's own tokens",
    "  below rather than inventing new ones.",
    "- NEVER use em dashes anywhere in the HTML.",
    "- Call save_adjusted_email once with the complete edited document.",
    "",
    "BRAND TOKENS (use these when the instruction needs a color/font and",
    "doesn't name one explicitly):",
    `- Primary: ${c.primary}`,
    `- Secondary: ${c.secondary}`,
    `- Accent: ${c.accent}`,
    `- Background: ${c.background}`,
    `- Text: ${c.text}`,
    `- Muted: ${c.muted}`,
    `- Heading font: ${f.heading}`,
    `- Body font: ${f.body}`,
  ].join("\n");

  const user = [
    `REQUESTED CHANGE: ${instruction}`,
    "",
    "CURRENT HTML:",
    currentHtml,
    "",
    "Call save_adjusted_email with the complete document, edited to match",
    "the requested change and nothing else.",
  ].join("\n");

  return { system, user };
}
