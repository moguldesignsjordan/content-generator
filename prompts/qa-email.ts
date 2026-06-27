import { z } from "zod";
import type { EmailDraftContent, TopicContext } from "@/lib/db/types";

export const QaSchema = z.object({
  meta_title: z
    .string()
    .describe("SEO meta title for this topic, under 60 characters. Can match the subject line if it's already strong."),
  meta_description: z
    .string()
    .describe("SEO meta description, under 155 characters. Compelling summary for search results."),
  keyword_used: z
    .boolean()
    .describe("True if the target keyword appears naturally in the email body or subject."),
  keyword_placement: z
    .string()
    .describe("Where the keyword appears — e.g. 'subject line and opening paragraph'. Empty string if not found."),
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

/** Builds the QA review prompt for a generated email draft. */
export function buildQaMessages(
  ctx: TopicContext,
  draft: EmailDraftContent,
): { system: string; user: string } {
  const bannedTerms = ctx.brand.voice_profile?.banned_terms ?? [];

  const system = [
    "You are a QA reviewer for marketing emails. Audit the draft against the criteria",
    "provided and generate SEO meta fields. Be direct and specific — flag only real",
    "problems, not stylistic preferences.",
  ].join("\n");

  const user = [
    "Audit this email draft:",
    "",
    `TOPIC: ${ctx.topic.title}`,
    ctx.topic.target_keyword ? `TARGET KEYWORD: ${ctx.topic.target_keyword}` : "",
    bannedTerms.length
      ? `BANNED TERMS (must not appear anywhere): ${bannedTerms.join(", ")}`
      : "",
    "",
    `SUBJECT: ${draft.subject}`,
    `PREHEADER: ${draft.preheader}`,
    "",
    "BODY (HTML — evaluate the readable text, not the markup):",
    draft.html,
    "",
    "Return the QA result.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
