import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";

// One-time style distillation for a reference email the user uploaded (the
// "write like this" library, migration 015). Runs once at upload; generation
// injects the stored result (see buildReferenceEmailsBlock in brand-voice.ts)
// instead of re-analyzing the raw email on every draft.

export const StyleProfileSchema = z.object({
  summary: z
    .string()
    .describe("2-3 sentences describing how this email is written."),
  traits: z
    .array(z.string())
    .min(3)
    .max(10)
    .describe(
      "Short imperative style rules a copywriter could follow to reproduce this style.",
    ),
  approx_words: z
    .number()
    .optional()
    .describe("Approximate body word count of the email."),
});

export type StyleProfileOutput = z.infer<typeof StyleProfileSchema>;

export const EXTRACT_STYLE_TOOL: Anthropic.Tool = {
  name: "save_style_profile",
  description:
    "Return the distilled writing-style profile of the email you were shown.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "2-3 sentences describing how this email is written: its length, register, structure, and what makes it feel the way it does.",
      },
      traits: {
        type: "array",
        minItems: 3,
        maxItems: 10,
        items: { type: "string" },
        description:
          "Short imperative style rules a copywriter could follow to reproduce this style, e.g. 'Open with a one-line hook, no greeting', 'Keep paragraphs to 1-2 sentences', 'Close with a single plain-text CTA line'.",
      },
      approx_words: {
        type: "number",
        description: "Approximate body word count (exclude subject/footer).",
      },
    },
    required: ["summary", "traits"],
  },
};

/** Builds the (system, user) pair for one style extraction. */
export function buildExtractStyleMessages(emailText: string): {
  system: string;
  user: string;
} {
  const system = [
    "You are a copy chief reverse-engineering the writing style of one email so",
    "other emails can be written the same way. Analyze HOW it is written, never",
    "WHAT it is about: length, structure (greeting, sections, sign-off), sentence",
    "rhythm and paragraph size, register (casual/formal, playful/plain), how it",
    "sells (direct ask, soft invite, story-first), formatting habits (lists,",
    "bold, one-liners), and CTA style. Describe the style so faithfully that a",
    "copywriter following your rules would produce an email that feels like the",
    "same person wrote it. Call save_style_profile with your analysis; no prose.",
  ].join("\n");

  const user = [
    "Distill the writing style of this email:",
    "",
    "--- EMAIL START ---",
    emailText,
    "--- EMAIL END ---",
    "",
    "Call save_style_profile.",
  ].join("\n");

  return { system, user };
}
