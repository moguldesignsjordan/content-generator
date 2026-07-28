import { z } from "zod";

/**
 * The angle contract, kept in its own leaf module.
 *
 * Both directions need it: pick-angle.ts produces an angle (and imports the
 * offer/CTA helpers from generate-email.ts), while generate-email.ts consumes
 * one. Defining it here keeps that from becoming an import cycle.
 */
export const AngleItemSchema = z.object({
  hook: z
    .string()
    .describe(
      "The angle in one sentence: the specific claim or promise this piece leads with.",
    ),
  reader_belief: z
    .string()
    .describe(
      "The belief in the reader's head this angle targets: what they currently think that this piece changes.",
    ),
  why_it_works: z
    .string()
    .describe(
      "Why this angle suits THIS audience, funnel stage, and business goal. Reference the strategy, not general marketing wisdom.",
    ),
  cta_rationale: z
    .string()
    .describe("Why the call to action is the natural next step from this angle."),
});

export type Angle = z.infer<typeof AngleItemSchema>;

/** The chosen angle, rendered as the mandate for the drafting call. */
export function buildChosenAngleBlock(angle: Angle | null | undefined): string {
  if (!angle) return "";
  return [
    "THE ANGLE FOR THIS PIECE (already decided; write THIS, do not pick a",
    "different one):",
    `- Lead with: ${angle.hook}`,
    `- The reader currently believes: ${angle.reader_belief}`,
    `- Why this lands: ${angle.why_it_works}`,
    `- The CTA follows because: ${angle.cta_rationale}`,
    "Every section should serve this angle. If a paragraph would fit equally",
    "well under a different angle, it isn't doing its job.",
  ].join("\n");
}
