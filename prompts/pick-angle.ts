import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  CampaignBrief,
  TopPerformingEmail,
  TopicContext,
} from "@/lib/db/types";
import {
  buildBrandVoiceBlock,
  buildCampaignBriefBlock,
  buildCompetitorReferenceBlock,
  buildGuidelinesBlock,
  buildPositioningBlock,
  buildStrategyBlock,
} from "./brand-voice";
import { buildOfferBlock, resolveCta } from "./generate-email";
import { AngleItemSchema } from "./angle";

export { buildChosenAngleBlock, type Angle } from "./angle";

/**
 * Angle selection: decide what the piece should ARGUE before deciding how to
 * say it.
 *
 * Generation used to go straight from "here is a topic title" to "write and
 * design a finished email", which forces the model to settle the strategy
 * question in passing while it is also managing voice, length, layout, and
 * HTML. That is where "technically fine, wrong angle" drafts come from.
 *
 * Three angles are proposed and one is chosen, rather than one being asserted,
 * because the comparison is what produces a real choice: the alternatives are
 * stored on the draft so a reviewer can later say "use the second one" without
 * paying for a fresh generation.
 */
export const AngleSchema = z.object({
  angles: z
    .array(AngleItemSchema)
    .length(3)
    .describe("Exactly 3 genuinely different angles, not three phrasings of one."),
  chosen_index: z
    .number()
    .int()
    .min(0)
    .max(2)
    .describe("Index into angles of the one to write. 0-based."),
  choice_reason: z
    .string()
    .describe("One or two sentences on why the chosen angle beats the other two."),
});

export type AngleOutput = z.infer<typeof AngleSchema>;

export const ANGLE_TOOL: Anthropic.Tool = {
  name: "choose_angle",
  description: "Propose three angles for this piece and choose the strongest one.",
  input_schema: {
    type: "object",
    properties: {
      angles: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        description: "Exactly 3 genuinely different angles.",
        items: {
          type: "object",
          properties: {
            hook: { type: "string", description: "The angle in one sentence." },
            reader_belief: {
              type: "string",
              description: "The reader belief this angle targets and changes.",
            },
            why_it_works: {
              type: "string",
              description:
                "Why it suits this audience, funnel stage, and business goal specifically.",
            },
            cta_rationale: {
              type: "string",
              description: "Why the CTA follows naturally from this angle.",
            },
          },
          required: ["hook", "reader_belief", "why_it_works", "cta_rationale"],
        },
      },
      chosen_index: {
        type: "integer",
        description: "0-based index of the angle to write.",
      },
      choice_reason: {
        type: "string",
        description: "Why the chosen angle beats the other two.",
      },
    },
    required: ["angles", "chosen_index", "choice_reason"],
  },
};

/**
 * Past winners, as evidence rather than instruction. Deliberately narrow: the
 * subject, the opening, and the numbers. Handing over whole past emails would
 * invite pastiche, and the point is to learn what this audience responds to,
 * not to rewrite last quarter's send.
 */
export function buildPerformanceBlock(top: TopPerformingEmail[] | undefined): string {
  if (!top?.length) return "";
  const pct = (n: number) => `${n.toFixed(1)}%`;
  return [
    "WHAT ACTUALLY PERFORMED FOR THIS BRAND (real send data, best first). Learn",
    "what this audience opens and clicks, never reuse the wording:",
    ...top.map((e) =>
      [
        `- Subject: ${e.subject}`,
        `  Opened ${pct(e.open_rate)}, clicked ${pct(e.click_rate)}`,
        e.opening ? `  Opened with: ${e.opening.replace(/\n+/g, " ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");
}

/** Builds the (system, user) pair for the angle-selection call. */
export function buildAngleMessages(
  ctx: TopicContext,
  opts: {
    brief?: CampaignBrief | null;
    topPerformers?: TopPerformingEmail[];
    channel?: "email" | "blog";
  } = {},
): { system: string; user: string } {
  const channel = opts.channel ?? "email";
  const { ctaText } = resolveCta(ctx);

  const system = [
    `You are the strategist for this brand, deciding what its next ${channel} should`,
    "argue. You are NOT writing the piece: you choose the angle, and someone else",
    "writes it. Be concrete and opinionated. A vague angle is worse than a narrow",
    "one that might be wrong.",
    "",
    buildGuidelinesBlock(ctx.brand),
    buildBrandVoiceBlock(ctx.brand, ctx.primaryIcp, channel),
    buildPositioningBlock(ctx.brand),
    buildStrategyBlock(ctx),
    buildCompetitorReferenceBlock(ctx.competitorRef),
    buildPerformanceBlock(opts.topPerformers),
    "",
    "WHAT MAKES AN ANGLE GOOD HERE:",
    "- It targets a belief this specific audience actually holds (their pains and",
    "  objections above are the evidence), not a generic pain point.",
    "- It fits the funnel stage: an awareness piece that hard-sells, or a bottom",
    "  of funnel piece that only raises awareness, is the wrong angle even when",
    "  the writing is good.",
    "- It serves the pillar's business goal without saying so out loud.",
    "- It could not be lifted wholesale onto a competitor's brand.",
    "- The three angles must differ in SUBSTANCE (different belief, different",
    "  promise), not in wording.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Choose the angle for this ${channel}.`,
    "",
    buildCampaignBriefBlock(opts.brief ?? null),
    `TITLE: ${ctx.topic.title}`,
    ctx.topic.target_keyword ? `TARGET KEYWORD: ${ctx.topic.target_keyword}` : "",
    ctx.topic.intent ? `SEARCH INTENT: ${ctx.topic.intent}` : "",
    ctx.topic.funnel_stage ? `FUNNEL STAGE: ${ctx.topic.funnel_stage}` : "",
    ctaText ? `CALL TO ACTION INTENT: ${ctaText}` : "",
    buildOfferBlock(ctx, opts.brief),
    "",
    "Call choose_angle with 3 substantially different angles and your pick.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
