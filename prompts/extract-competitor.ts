import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";

// One-time STRATEGY distillation for a competitor ad the user saved (the
// "learn from this" swipe file, migration 025). Sibling of extract-style.ts
// (reads an email's words) and extract-design.ts (reads an email's picture):
// this one reads a competitor ad, either text or a screenshot, and extracts
// HOW it persuades, never WHAT it says. Runs once at save; generation injects
// the stored result (see buildCompetitorReferenceBlock in brand-voice.ts)
// with anti-copy framing, so no draft ever re-reads the raw ad.

export const CompetitorProfileSchema = z.object({
  summary: z.string().describe("2-3 sentences on HOW this ad persuades."),
  hook_type: z
    .string()
    .describe(
      "The opening hook's type, e.g. 'bold claim', 'question', 'social proof', 'before/after'.",
    ),
  angle: z
    .string()
    .describe(
      "The persuasion/editorial angle, e.g. 'urgency', 'exclusivity', 'problem/solution'.",
    ),
  structure: z
    .array(z.string())
    .min(2)
    .max(10)
    .describe("The ad's beats/sections in order, top to bottom."),
  persuasion_levers: z
    .array(z.string())
    .optional()
    .describe(
      "Specific persuasion techniques used, e.g. scarcity, authority, social proof, reciprocity.",
    ),
  cta_style: z
    .string()
    .describe("How the ad asks for the click/action: its tone and framing."),
  register: z
    .string()
    .optional()
    .describe("The register/voice: casual, formal, playful, urgent, and so on."),
});

export type CompetitorProfileOutput = z.infer<typeof CompetitorProfileSchema>;

export const EXTRACT_COMPETITOR_TOOL: Anthropic.Tool = {
  name: "save_competitor_profile",
  description:
    "Return the distilled marketing-STRATEGY profile of the competitor ad you were shown. Never transcribe its words.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "2-3 sentences on HOW this ad persuades: its hook, angle, and overall approach.",
      },
      hook_type: {
        type: "string",
        description:
          "The opening hook's type, e.g. 'bold claim', 'question', 'social proof', 'before/after'.",
      },
      angle: {
        type: "string",
        description:
          "The persuasion/editorial angle, e.g. 'urgency', 'exclusivity', 'problem/solution'.",
      },
      structure: {
        type: "array",
        minItems: 2,
        maxItems: 10,
        items: { type: "string" },
        description:
          "The ad's beats/sections in order, top to bottom, e.g. 'bold claim headline', 'three quick proof points', 'single urgent CTA'.",
      },
      persuasion_levers: {
        type: "array",
        items: { type: "string" },
        description:
          "Specific persuasion techniques the ad leans on: scarcity, authority, social proof, reciprocity, and so on.",
      },
      cta_style: {
        type: "string",
        description: "How the ad asks for the click/action: its tone and framing, not its exact words.",
      },
      register: {
        type: "string",
        description: "The register/voice: casual, formal, playful, urgent, and so on.",
      },
    },
    required: ["summary", "hook_type", "angle", "structure", "cta_style"],
  },
};

/**
 * Builds the (system, user) pair for one competitor-strategy extraction. When
 * content is given it rides in the user text; an accompanying screenshot (if
 * any) is attached as an image block by the caller.
 */
export function buildExtractCompetitorMessages(content?: string): {
  system: string;
  user: string;
} {
  const system = [
    "You are a marketing strategist reverse-engineering HOW one competitor ad",
    "persuades, so another brand can adapt the STRATEGY without copying it.",
    "Analyze its hook, angle, structure (the beats top to bottom), persuasion",
    "levers (scarcity, social proof, authority, and so on), and CTA style.",
    "",
    "NEVER transcribe, quote, or summarize its actual words, claims, offer,",
    "numbers, or brand name. Distill the strategy only: the words themselves",
    "are noise another brand's own copy will replace. Call",
    "save_competitor_profile with your analysis; no prose in your reply.",
  ].join("\n");

  const user = [
    "Distill the marketing strategy of this competitor ad. Ignore what it",
    "actually says; focus on how it persuades.",
    ...(content ? ["", "--- AD TEXT START ---", content, "--- AD TEXT END ---"] : []),
    "",
    "Call save_competitor_profile.",
  ].join("\n");

  return { system, user };
}
