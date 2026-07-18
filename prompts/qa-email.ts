import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { CampaignBrief, EmailCopy, TopicContext } from "@/lib/db/types";

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
    .describe(
      "True only if no banned terms were found AND the keyword is used AND unsupported_specifics is empty. False otherwise.",
    ),
  issues: z
    .array(z.string())
    .describe("Specific, actionable issues to fix before approving. Empty array if qa_pass is true."),
  unsupported_specifics: z
    .array(z.string())
    .describe(
      "Every number, statistic, date, price, or named claim in the copy that does NOT trace back to anything in the GROUNDING FACTS below. Empty array if every specific claim is backed by a real fact.",
    ),
  proof_used: z
    .boolean()
    .describe(
      "True if the brief's proof (a real number, result, or story) actually appears in the copy. False if a proof was given but the copy never used it; also false when no proof was given at all.",
    ),
  offer_terms_accurate: z
    .boolean()
    .describe(
      "True if every offer term in the copy (deal, deadline, price) matches the GROUNDING FACTS exactly, with no invented term. True by default when there is no offer to check.",
    ),
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
      qa_pass: {
        type: "boolean",
        description: "True only if no banned terms, keyword is used, and unsupported_specifics is empty.",
      },
      issues: { type: "array", items: { type: "string" }, description: "Actionable issues, or empty." },
      unsupported_specifics: {
        type: "array",
        items: { type: "string" },
        description:
          "Every number, statistic, date, price, or named claim in the copy that isn't backed by GROUNDING FACTS. Empty if none.",
      },
      proof_used: {
        type: "boolean",
        description: "True if the brief's proof actually appears in the copy; false if given but unused or if none was given.",
      },
      offer_terms_accurate: {
        type: "boolean",
        description: "True if every offer term in the copy matches GROUNDING FACTS exactly; true by default with no offer.",
      },
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
      "unsupported_specifics",
      "proof_used",
      "offer_terms_accurate",
    ],
  },
};

/**
 * The real facts a draft is allowed to state as specifics: the brief's proof
 * and offer terms, plus the mapped product's price/deliverables. This is the
 * QA reviewer's source of truth for unsupported_specifics; empty string when
 * there's nothing to ground against (a thin brief still gets checked, it just
 * has no allowlist, so ANY number/claim in the copy is unsupported).
 */
function buildGroundingFactsBlock(
  ctx: TopicContext,
  brief: CampaignBrief | null | undefined,
): string {
  const lines: string[] = [];
  if (brief?.proof) lines.push(`  Proof: ${brief.proof}`);
  if (brief?.offer_deal) lines.push(`  Offer deal: ${brief.offer_deal}`);
  if (brief?.offer_deadline) lines.push(`  Offer deadline: ${brief.offer_deadline}`);
  if (brief?.offer_price) lines.push(`  Offer price: ${brief.offer_price}`);
  if (brief?.offer_exclusions) lines.push(`  Not for: ${brief.offer_exclusions}`);
  const p = ctx.product;
  if (p?.price_point) lines.push(`  Product price: ${p.price_point}`);
  if (p?.deliverables?.length) lines.push(`  Product includes: ${p.deliverables.join("; ")}`);
  if (!lines.length) {
    return "GROUNDING FACTS: none on file. Any number, statistic, date, price, or named claim in the copy is unsupported.";
  }
  return ["GROUNDING FACTS (the only real specifics this draft may state):", ...lines].join("\n");
}

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
  brief?: CampaignBrief | null,
): { system: string; user: string } {
  const bannedTerms = ctx.brand.voice_profile?.banned_terms ?? [];

  const system = [
    "You are a QA reviewer for marketing emails. Audit the copy against the criteria",
    "provided and generate SEO meta fields. Be direct and specific, flag only real",
    "problems, not stylistic preferences.",
    "",
    "GROUNDING CHECK: cross-reference every number, statistic, date, price, or",
    "named claim in the copy against GROUNDING FACTS in the user message. List",
    "anything that isn't backed by those facts in unsupported_specifics, even",
    "when it reads as plausible marketing copy: a plausible-sounding invented",
    "number is exactly the failure mode this check exists to catch.",
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
    buildGroundingFactsBlock(ctx, brief),
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
