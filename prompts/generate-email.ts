import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  EmailTemplateId,
  TopicContext,
  Topic,
} from "@/lib/db/types";
import { buildBrandVoiceBlock, buildPositioningBlock } from "./brand-voice";

// Zod schema for the COPY only (used to validate the model's tool input).
// Claude no longer produces HTML; the email templates render this copy into a
// designed, on-brand layout. Length limits are instructed in the prompt; the
// QA pass (Slice 6) verifies them.
export const EmailDraftSchema = z.object({
  subject: z.string().describe("Email subject line, under 60 characters."),
  preheader: z
    .string()
    .describe("Preview text shown after the subject, under 150 characters."),
  headline: z
    .string()
    .describe("The email's H1: one sharp, benefit-driven line."),
  body_sections: z
    .array(
      z.object({
        heading: z
          .string()
          .optional()
          .describe("Optional subheading for this section."),
        body: z
          .string()
          .describe(
            "One or more paragraphs of plain-text copy. Plain text only, no HTML.",
          ),
      }),
    )
    .min(1)
    .max(5)
    .describe("1 to 5 body sections, in order."),
  cta_text: z
    .string()
    .describe("The call-to-action button text, in brand voice."),
  cta_url: z
    .string()
    .optional()
    .describe("Destination URL if known from the topic; otherwise omit."),
});

export type EmailDraftOutput = z.infer<typeof EmailDraftSchema>;

/**
 * Forced tool the model must call to return email copy. We use tool use (with
 * tool_choice forced) rather than output_config json_schema: tool inputs are
 * reliably structured and can't come back as markdown-fenced JSON.
 */
export const EMAIL_TOOL: Anthropic.Tool = {
  name: "save_email_draft",
  description:
    "Return the email copy for this topic. Fill every field with on-brand, plain-text copy.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Subject line, under 60 characters." },
      preheader: { type: "string", description: "Preview text, under 150 characters." },
      headline: { type: "string", description: "The email's H1: one sharp line." },
      body_sections: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            heading: { type: "string", description: "Optional subheading." },
            body: { type: "string", description: "Plain-text paragraphs, no HTML." },
          },
          required: ["body"],
        },
      },
      cta_text: { type: "string", description: "CTA button text, in brand voice." },
      cta_url: { type: "string", description: "Destination URL, or omit if unknown." },
    },
    required: ["subject", "preheader", "headline", "body_sections", "cta_text"],
  },
};

/**
 * Resolves the call-to-action for a topic by its funnel stage:
 *   topic.funnel_stage -> strategy.funnel_definition[stage].cta_type
 *                      -> brand.voice_profile.cta_library[cta_type]
 */
export function resolveCta(ctx: TopicContext): {
  ctaType: string | null;
  ctaText: string | null;
} {
  const stage = ctx.topic.funnel_stage;
  if (!stage) return { ctaType: null, ctaText: null };

  const ctaType = ctx.strategy.funnel_definition?.[stage]?.cta_type ?? null;
  const ctaText = ctaType
    ? ctx.brand.voice_profile?.cta_library?.[ctaType] ?? null
    : null;

  return { ctaType, ctaText };
}

/**
 * Picks the email template for a topic from its distribution recipe. The seed
 * tags topics with `newsletter_tip` / `newsletter_feature` / `newsletter_howto`;
 * the first match wins, defaulting to a quick tip.
 */
export function resolveEmailTemplateId(topic: Topic): EmailTemplateId {
  const recipe = topic.distribution_recipe ?? [];
  const known: EmailTemplateId[] = [
    "newsletter_tip",
    "newsletter_feature",
    "newsletter_howto",
  ];
  for (const r of recipe) {
    if ((known as string[]).includes(r)) return r as EmailTemplateId;
  }
  return "newsletter_tip";
}

/** Builds the (system, user) message pair for email generation. */
export function buildEmailMessages(
  ctx: TopicContext,
  rejectionContext?: { feedback: string; previousSubject: string; previousPreheader: string },
): {
  system: string;
  user: string;
} {
  const { topic, brand } = ctx;
  const voiceBlock = buildBrandVoiceBlock(brand, ctx.primaryIcp);
  const positioningBlock = buildPositioningBlock(brand);
  const { ctaText } = resolveCta(ctx);
  const templateId = resolveEmailTemplateId(topic);
  const templateShape =
    templateId === "newsletter_howto"
      ? "a step-by-step how-to (each body section is one numbered step)"
      : templateId === "newsletter_feature"
        ? "an editorial feature (2 to 3 subheaded sections)"
        : "a single sharp tip (one body section)";

  const system = [
    `You are the email copywriter for ${brand.name}. You write the COPY for a`,
    "single marketing email that sounds exactly like the brand and serves its strategy.",
    "",
    voiceBlock,
    positioningBlock,
    "",
    "RULES:",
    "- Write in the brand voice above. Sound human, never like generic AI marketing copy.",
    "- Use the target keyword and the audience's own vocabulary naturally; never keyword-stuff.",
    "- Match the email's call-to-action to the funnel stage (provided below).",
    "- You produce COPY, not HTML. The body fields hold plain-text paragraphs (no markup);",
    "  the visual design is applied separately by a branded template.",
    "- The unsubscribe link is added automatically by the template; do not include it.",
    "- Subject under 60 characters; preheader under 150 characters.",
    "- NEVER use em dashes or double-hyphens as punctuation. Use a comma, colon, or period.",
    "- Call the save_email_draft tool with every field filled. Do not write prose, labels,",
    "  or preambles like Subject:. Fill the tool fields directly.",
  ].join("\n");

  const user = [
    `Write the copy for one email. The layout will be: ${templateShape}.`,
    "",
    `TITLE: ${topic.title}`,
    topic.target_keyword ? `TARGET KEYWORD: ${topic.target_keyword}` : "",
    topic.intent ? `SEARCH INTENT: ${topic.intent}` : "",
    topic.funnel_stage ? `FUNNEL STAGE: ${topic.funnel_stage}` : "",
    ctaText
      ? `CALL TO ACTION (use this intent, write the button text in brand voice): ${ctaText}`
      : "CALL TO ACTION: a soft invitation to reply or learn more.",
    topic.maps_to_product ? `RELATED OFFER: ${topic.maps_to_product}` : "",
    topic.target_keyword
      ? `CTA URL: leave blank unless the related offer implies an obvious destination.`
      : "",
    ...(rejectionContext
      ? [
          "",
          "REVISION REQUEST: address this feedback in the new version:",
          `FEEDBACK: ${rejectionContext.feedback}`,
          `PREVIOUS SUBJECT WAS: ${rejectionContext.previousSubject}`,
          `PREVIOUS PREHEADER WAS: ${rejectionContext.previousPreheader}`,
          "Write a meaningfully different email that fixes these issues.",
        ]
      : []),
    "",
    "Call save_email_draft with every field filled.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
