import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";

/**
 * The design critique: a second look at the rendered email, with fresh eyes
 * and nothing else to juggle.
 *
 * The drafting call writes copy, picks a structure, and hand-builds a full
 * HTML document in one pass. Layout is the thing that suffers when attention
 * is split, which is why "the design is off" survived every prompt rule added
 * to the design system: the rules were there, the model was just busy.
 *
 * Edits come back as find/replace patches rather than a rewritten document, so
 * a critique can only ever touch the spans it names (see applyEdits, which
 * rejects a find that matches zero or ambiguously many places). A bad critique
 * costs a skipped patch, never a mangled email.
 */
export const DesignCritiqueSchema = z.object({
  verdict: z
    .string()
    .describe(
      "One sentence on how the design reads overall. Say it's solid when it is; not every email needs changing.",
    ),
  edits: z
    .array(
      z.object({
        problem: z
          .string()
          .describe("The specific visual defect, in a few words (what looks wrong, and where)."),
        find: z
          .string()
          .describe(
            "The EXACT substring of the HTML to replace, copied character for character, long enough to appear exactly once.",
          ),
        replace: z.string().describe("The replacement HTML for that exact span."),
      }),
    )
    .max(6)
    .describe(
      "Up to 6 targeted fixes, highest impact first. Empty array when the design is already good.",
    ),
});

export type DesignCritiqueOutput = z.infer<typeof DesignCritiqueSchema>;

export const DESIGN_CRITIQUE_TOOL: Anthropic.Tool = {
  name: "critique_design",
  description: "Return targeted visual fixes for a designed email, as exact find/replace edits.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", description: "One sentence on how the design reads." },
      edits: {
        type: "array",
        maxItems: 6,
        description: "Up to 6 targeted fixes, highest impact first. Empty if none needed.",
        items: {
          type: "object",
          properties: {
            problem: { type: "string", description: "The specific visual defect." },
            find: {
              type: "string",
              description:
                "Exact substring of the HTML to replace, copied character for character, unique in the document.",
            },
            replace: { type: "string", description: "Replacement HTML for that span." },
          },
          required: ["problem", "find", "replace"],
        },
      },
    },
    required: ["verdict", "edits"],
  },
};

/**
 * Builds the (system, user) pair for the critique.
 *
 * The design brief is passed in verbatim, the same string the drafting call
 * was given, so the critique is judging against the exact spec that was
 * requested rather than a paraphrase of it.
 */
export function buildDesignCritiqueMessages(
  html: string,
  designBrief: string,
): { system: string; user: string } {
  const system = [
    "You are an email designer reviewing a finished HTML email before it goes to",
    "a client. You know the constraints of email HTML: tables, inline styles, no",
    "flexbox, no grid, no external CSS, no JavaScript.",
    "",
    "Judge it against the design brief below, and be honest in both directions.",
    "Returning zero edits on a good email is a correct answer and the right one",
    "more often than not. Do not invent work.",
    "",
    "WHAT TO LOOK FOR, in priority order:",
    "1. Hierarchy: does the eye land on the headline, then the point, then the",
    "   CTA? A headline that competes with body text is the most common failure.",
    "2. Spacing rhythm: consistent padding between sections, no cramped or",
    "   orphaned blocks, generous breathing room around the CTA.",
    "3. The CTA: exactly one, unmissable, with real padding and enough contrast.",
    "4. Image treatment: full-bleed or inset consistently, never stretched or",
    "   squeezed, with spacing that matches the rest of the layout.",
    "5. Type: sane sizes and line-heights (body at least 15px, line-height at",
    "   least 1.5), no more than two font families.",
    "6. Header and footer: proportionate to the body, not dominating it.",
    "",
    "RULES FOR YOUR EDITS:",
    "- Each `find` must be an EXACT substring of the HTML, copied character for",
    "  character, and long enough to be unique. An edit whose find text doesn't",
    "  match exactly once is discarded, so include surrounding markup when in",
    "  doubt.",
    "- Keep every style inline. Never add <style> blocks, classes, scripts, or",
    "  external resources.",
    "- Never change the copy's words, the {$unsubscribe} tag, any data-region",
    "  attribute, any src URL, or any href. You are changing how it LOOKS, not",
    "  what it says or where it points.",
    "- Preserve the existing dark-mode media query and its !important rules.",
    "- Never use em dashes or en dashes anywhere.",
  ].join("\n");

  const user = [
    "THE DESIGN BRIEF THIS EMAIL WAS BUILT TO:",
    designBrief,
    "",
    "THE RENDERED EMAIL:",
    html,
    "",
    "Call critique_design. Return only fixes that would make a visible",
    "difference to someone opening this in their inbox; an empty edits array is",
    "the right answer for a design that already works.",
  ].join("\n");

  return { system, user };
}
