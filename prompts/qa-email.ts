import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { EmailCopy, TopicContext } from "@/lib/db/types";

export const QaSchema = z.object({
  meta_title: z
    .string()
    .describe("SEO meta title for this topic, under 60 characters. Can match the subject line if it's already strong."),
  meta_description: z
    .string()
    .describe("SEO meta description, under 155 characters. Compelling summary for search results."),
  keyword_used: z
    .boolean()
    .describe(
      "True only if the target keyword (or a close natural variant) appears where it counts: the subject line, the headline, or the first paragraph.",
    ),
  keyword_placement: z
    .string()
    .describe(
      "Where the keyword lands, from: 'subject', 'headline', 'first paragraph', 'later body only', or empty string if not found.",
    ),
  banned_terms_found: z
    .array(z.string())
    .describe("Any banned terms found verbatim in the subject, preheader, or body. Empty array if none."),
  readability_note: z
    .string()
    .describe("One sentence on readability: sentence length, clarity, and flow. Flag if sentences consistently run long or jargon appears."),
  qa_pass: z
    .boolean()
    .describe("True only if no banned terms were found AND the keyword is used. False otherwise."),
  issues: z
    .array(z.string())
    .describe("Specific, actionable issues to fix before approving. Empty array if qa_pass is true."),
});

export type QaOutput = z.infer<typeof QaSchema>;

/** Forced tool the QA reviewer must call to return its audit result. */
export const QA_TOOL: Anthropic.Tool = {
  name: "qa_review",
  description: "Return the QA audit result for the email draft.",
  input_schema: {
    type: "object",
    properties: {
      meta_title: { type: "string", description: "SEO meta title, under 60 characters." },
      meta_description: { type: "string", description: "SEO meta description, under 155 characters." },
      keyword_used: {
        type: "boolean",
        description:
          "True only if the keyword (or close variant) appears in the subject, headline, or first paragraph.",
      },
      keyword_placement: {
        type: "string",
        description:
          "One of: 'subject', 'headline', 'first paragraph', 'later body only', or empty string.",
      },
      banned_terms_found: { type: "array", items: { type: "string" }, description: "Banned terms found, or empty." },
      readability_note: { type: "string", description: "One sentence on readability." },
      qa_pass: { type: "boolean", description: "True only if no banned terms and keyword is used." },
      issues: { type: "array", items: { type: "string" }, description: "Actionable issues, or empty." },
    },
    required: [
      "meta_title",
      "meta_description",
      "keyword_used",
      "keyword_placement",
      "banned_terms_found",
      "readability_note",
      "qa_pass",
      "issues",
    ],
  },
};

/**
 * Builds the QA review prompt from the STRUCTURED copy, not the rendered
 * HTML. QA is mechanical extraction/classification (keyword placement, banned
 * terms, meta fields), so it neither needs nor benefits from the markup, and
 * dropping it cuts the input to a fraction on every single generation. Runs
 * on FAST_MODEL for the same reason.
 */
export function buildQaMessages(
  ctx: TopicContext,
  copy: EmailCopy,
): { system: string; user: string } {
  const bannedTerms = ctx.brand.voice_profile?.banned_terms ?? [];

  const system = [
    "You are a QA reviewer for marketing emails. Audit the copy against the criteria",
    "provided and generate SEO meta fields. Be direct and specific, flag only real",
    "problems, not stylistic preferences.",
  ].join("\n");

  const bodyLines = copy.body_sections
    .map((s, i) =>
      s.heading
        ? `SECTION ${i + 1} HEADING: ${s.heading}\nSECTION ${i + 1} BODY: ${s.body}`
        : `SECTION ${i + 1} BODY: ${s.body}`,
    )
    .join("\n\n");

  const user = [
    "Audit this email copy:",
    "",
    `TOPIC: ${ctx.topic.title}`,
    ctx.topic.target_keyword ? `TARGET KEYWORD: ${ctx.topic.target_keyword}` : "",
    bannedTerms.length
      ? `BANNED TERMS (must not appear anywhere): ${bannedTerms.join(", ")}`
      : "",
    "",
    `SUBJECT: ${copy.subject}`,
    `PREHEADER: ${copy.preheader}`,
    `HEADLINE: ${copy.headline}`,
    "",
    bodyLines,
    "",
    `CTA TEXT: ${copy.cta_text}`,
    "",
    "Call the qa_review tool with the audit result.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
