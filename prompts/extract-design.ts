import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";

// One-time DESIGN distillation for an email screenshot the user uploaded (the
// "make mine look like this" library, migration 016). The sibling of
// extract-style.ts: that one reads an email's words, this one reads an email's
// picture. Runs once at upload; generation injects the stored result (see
// buildDesignReferenceBlock in email-design.ts) alongside the raw image, so no
// draft ever re-analyzes the screenshot.

export const EmailDesignProfileSchema = z.object({
  summary: z
    .string()
    .describe("2-3 sentences describing the overall look of this email design."),
  layout: z
    .array(z.string())
    .min(2)
    .max(12)
    .describe("The sections in order, top to bottom."),
  palette_notes: z.string().optional(),
  typography_notes: z.string().optional(),
});

export type EmailDesignProfileOutput = z.infer<typeof EmailDesignProfileSchema>;

export const EXTRACT_DESIGN_TOOL: Anthropic.Tool = {
  name: "save_design_profile",
  description:
    "Return the distilled DESIGN profile of the email screenshot you were shown.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "2-3 sentences on the overall look: how dense or airy it is, how much of the space is image versus text, its visual weight and mood, what a designer would call the style.",
      },
      layout: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: { type: "string" },
        description:
          "The sections in order, top to bottom, each named as a designer would, e.g. 'centered logo bar on white', 'full-width hero image with headline overlaid', 'two-column product grid, image above price', 'single wide dark CTA button', 'dark footer bar with small centered links'.",
      },
      palette_notes: {
        type: "string",
        description:
          "How color is used STRUCTURALLY (where the dark blocks sit, how much white space, how the accent is spent), not the specific hex values: the brand's own colors get swapped in.",
      },
      typography_notes: {
        type: "string",
        description:
          "The type hierarchy: relative heading-to-body size, weight contrast, all-caps or letterspaced elements, alignment.",
      },
    },
    required: ["summary", "layout"],
  },
};

/**
 * Builds the (system, user) pair for one design extraction. The image itself
 * rides in the user turn as a content block; this only supplies the text.
 */
export function buildExtractDesignMessages(): { system: string; user: string } {
  const system = [
    "You are an email designer reverse-engineering the DESIGN of one email from",
    "a screenshot, so other emails can be built to look the same way.",
    "",
    "Describe the design ONLY, never the marketing copy. Do not transcribe or",
    "summarize the words, the offer, the brand, or the products: another brand's",
    "content will be poured into this layout, so the words are noise. What",
    "matters is the SHAPE: the order of the sections top to bottom, how tall and",
    "dense each one is, the spacing rhythm, where images sit and how big they",
    "are, the type hierarchy, how buttons look (filled or outlined, sharp or",
    "rounded, full-width or inline), and how color is spent across the layout.",
    "",
    "Be concrete enough that a designer who never saw the screenshot could",
    "rebuild the same structure from your notes alone. Call save_design_profile;",
    "no prose in your reply.",
  ].join("\n");

  const user = [
    "Distill the design of the email in this screenshot: its layout, spacing,",
    "type hierarchy, button treatment, and how it uses images and color.",
    "Ignore what the email actually says.",
    "",
    "Call save_design_profile.",
  ].join("\n");

  return { system, user };
}
