import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { CampaignBrief, TopicContext } from "@/lib/db/types";
import { AI_TELL_AUDIT_RULES } from "./ai-tells";
import { buildGroundingFactsBlock } from "./qa-email";

/**
 * The content-agnostic half of QA: invented specifics and AI tells.
 *
 * Email QA (qa-email.ts) also does SEO meta generation and keyword placement,
 * which blogs already compute in code (runBlogChecks). This is the part blogs
 * were missing entirely: until now a blog post could invent a statistic and
 * nothing anywhere would notice, because blog QA was code-only and code can't
 * tell a real number from a plausible one.
 *
 * Runs on FAST_MODEL like its email counterpart: this is classification
 * against a fact list, not writing.
 */
export const GroundingQaSchema = z.object({
  unsupported_specifics: z
    .array(z.string())
    .describe(
      "Every number, statistic, date, price, or named claim in the content that does NOT trace back to the GROUNDING FACTS. Empty array if every specific claim is backed by a real fact.",
    ),
  ai_tells_found: z
    .array(z.string())
    .describe(
      "Every phrase matching one of the AI TELLS, quoted verbatim. Structural or verbatim matches only, never a stylistic preference. Empty array if none.",
    ),
  issues: z
    .array(z.string())
    .describe(
      "Specific, actionable problems to fix before publishing. Empty array when there's nothing real to fix.",
    ),
});

export type GroundingQaOutput = z.infer<typeof GroundingQaSchema>;

export const GROUNDING_QA_TOOL: Anthropic.Tool = {
  name: "grounding_review",
  description: "Return the grounding and AI-tell audit for a piece of content.",
  input_schema: {
    type: "object",
    properties: {
      unsupported_specifics: {
        type: "array",
        items: { type: "string" },
        description:
          "Numbers, statistics, dates, prices, or named claims not backed by GROUNDING FACTS. Empty if none.",
      },
      ai_tells_found: {
        type: "array",
        items: { type: "string" },
        description: "Phrases matching the AI TELLS list, quoted verbatim. Empty if none.",
      },
      issues: {
        type: "array",
        items: { type: "string" },
        description: "Actionable issues, or empty.",
      },
    },
    required: ["unsupported_specifics", "ai_tells_found", "issues"],
  },
};

/**
 * Builds the audit prompt from PLAIN TEXT, not rendered markup: this check is
 * about what the copy claims, so the markup is cost with no signal (the same
 * reasoning behind buildQaMessages auditing structured copy over HTML).
 */
export function buildGroundingQaMessages(
  ctx: TopicContext,
  text: string,
  brief?: CampaignBrief | null,
): { system: string; user: string } {
  const system = [
    "You are a QA reviewer for published marketing content. Flag only real",
    "problems, never stylistic preferences.",
    "",
    "GROUNDING CHECK: cross-reference every number, statistic, date, price, or",
    "named claim against GROUNDING FACTS in the user message. List anything not",
    "backed by those facts in unsupported_specifics, even when it reads as",
    "plausible marketing copy: a plausible-sounding invented number is exactly",
    "the failure mode this check exists to catch.",
    "",
    ...AI_TELL_AUDIT_RULES,
  ].join("\n");

  const user = [
    "Audit this content:",
    "",
    `TITLE: ${ctx.topic.title}`,
    "",
    buildGroundingFactsBlock(ctx, brief),
    "",
    "CONTENT:",
    text,
    "",
    "Call the grounding_review tool with the audit result.",
  ].join("\n");

  return { system, user };
}
