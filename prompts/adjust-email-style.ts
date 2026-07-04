import type { Anthropic } from "@anthropic-ai/sdk";
import type { BrandTokens } from "@/lib/email/templates/types";

// Lightweight, single-shot style editing for an EXISTING email draft: no new
// copy, no new draft version, no thinking, just "take this HTML and this
// instruction and return the SMALL edit(s) needed." Deliberately NOT an
// agent (no planning/critique loop, no multi-step tool use).
//
// Patch-based, not full-document echo: the model reads the whole HTML but
// only OUTPUTS the exact-match find/replace pairs describing what changes.
// This is the main cost/speed lever (output tokens are what's slow and
// expensive, and a full email document is ~4-5k tokens regenerated on every
// tweak whether the change is one word or not) and a safety improvement:
// find must match the current HTML verbatim, so the model is mechanically
// unable to alter anything outside the span it names, unlike a full rewrite
// where "preserve everything else" was only ever a request, not a guarantee.

export interface StyleEdit {
  find: string;
  replace: string;
  /** Set true only for a deliberate "change every instance" request. */
  replace_all?: boolean;
}

export interface AdjustStyleToolInput {
  edits: StyleEdit[];
  client_support_caveat?: string;
}

export const ADJUST_STYLE_TOOL: Anthropic.Tool = {
  name: "save_style_patch",
  description:
    "Return the small, exact find/replace edit(s) needed to apply the " +
    "requested style change. Do NOT return the whole document, only the " +
    "minimal snippets that change.",
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
                "An EXACT, VERBATIM substring copied from the current HTML " +
                "(same whitespace, quotes, everything). Long enough to be " +
                "unique in the document, but as short as possible, usually " +
                "just the one style attribute or tag you're changing plus a " +
                "few characters of surrounding context if needed to make it " +
                "unique. Never paste large blocks you aren't changing.",
            },
            replace: {
              type: "string",
              description: "What that exact substring becomes.",
            },
            replace_all: {
              type: "boolean",
              description:
                "true ONLY if the user explicitly wants every occurrence " +
                "changed (e.g. \"make every accent color purple\"). Omit or " +
                "false otherwise, since find matching more than once without " +
                "this is ambiguous and will be rejected.",
            },
          },
          required: ["find", "replace"],
        },
        description:
          "One entry per distinct change. Most instructions need exactly " +
          "one; use more only when genuinely separate parts of the document " +
          "need to change.",
      },
      client_support_caveat: {
        type: "string",
        description:
          "One short sentence ONLY if you used a technique some email " +
          "clients don't fully support (e.g. gradient text via " +
          "background-clip:text), explaining what those clients will show " +
          "instead. Omit entirely for ordinary changes.",
      },
    },
    required: ["edits"],
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
    "make ONLY the visual/style change the user asks for, expressed as",
    "small, exact find/replace edits, not a rewrite of the document.",
    "",
    "DISAMBIGUATING WHAT THE USER MEANS (get this right, it's the most common",
    "way these instructions go wrong):",
    "- \"the header\", \"the header bar\", \"the header background\" = the header",
    "  SECTION'S background/container (the top band behind the logo). Change",
    "  its background-color / background property.",
    "- \"the header text\", \"the wordmark\", \"the logo text\", \"the brand name\"",
    "  = the actual text characters in the header (e.g. the brand name).",
    "  Change the text's own styling (color, or a text gradient, see below),",
    "  NOT the section background.",
    "- Apply the same logic elsewhere: \"the headline\" or \"the title\" means",
    "  the <h1> text itself; \"the button\" means the CTA link/table cell;",
    "  \"the background\" alone (no qualifier) means the outer page background",
    "  behind the card, not any specific section.",
    "- If truly ambiguous, prefer the CONTAINER/background reading over the",
    "  text reading, that's what most people mean by an unqualified noun, but",
    "  never touch both a container AND its text based on one ambiguous word.",
    "",
    "GRADIENT TEXT (e.g. \"make the header text a gradient\"): this needs a",
    "specific technique, not just a color change:",
    "  background: linear-gradient(...);",
    "  -webkit-background-clip: text;",
    "  background-clip: text;",
    "  -webkit-text-fill-color: transparent;",
    "  color: <a solid color close to one of the gradient stops>;",
    "The final color: line is REQUIRED as a fallback: some email clients",
    "(notably Outlook desktop) don't support background-clip:text and will",
    "show that solid color instead, never leave it black or unset.",
    "",
    "HOW TO WRITE EDITS:",
    "- Each find must be copied EXACTLY from the CURRENT HTML below, same",
    "  whitespace and quotes, character for character. It must be long",
    "  enough that it's unmistakable which spot you mean, but otherwise as",
    "  short as possible: usually just the style attribute value or the one",
    "  tag opening you're changing.",
    "- Example: to change a header's background color, an edit might be",
    '  find: `style="padding:40px 48px 0 48px;"`',
    '  replace: `style="padding:40px 48px 0 48px;background-color:#2563EB;"`',
    "  Note this does NOT include the rest of the document, just the one",
    "  attribute being touched.",
    "- Do not change any copy, wording, subject matter, or text content.",
    "  Do not add, remove, or reorder sections unless explicitly asked.",
    "- Keep the same overall structure: nested <table role=\"presentation\">",
    "  layout (Outlook-safe, no CSS grid/flexbox/floats/position), the hidden",
    "  preheader div, the 600px card, all inline styles.",
    "- ALL styles stay inline on elements (email HTML is not browser HTML).",
    "  No external stylesheets, no <link>, no JavaScript.",
    "- If asked for a gradient BACKGROUND (not text), set a solid",
    "  background-color fallback (for clients that ignore CSS gradients) AND a",
    "  background: linear-gradient(...) on the same element.",
    "- Never touch the footer unsubscribe link, it must stay {$unsubscribe}.",
    "- If the instruction doesn't specify colors, use the brand's own tokens",
    "  below rather than inventing new ones. But if the instruction DOES name",
    "  a specific color, palette, or look, even one that isn't a brand token,",
    "  use exactly that. The user is explicitly overriding the brand default",
    "  for this one change, on purpose, honor it exactly as asked.",
    "- NEVER use em dashes anywhere.",
    "- Call save_style_patch once with the minimal edit(s) needed.",
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
    "Call save_style_patch with the minimal exact find/replace edit(s) that",
    "apply this change and nothing else.",
  ].join("\n");

  return { system, user };
}
