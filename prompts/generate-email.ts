import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  CampaignBrief,
  EmailTemplateId,
  TopicContext,
  Topic,
} from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import {
  buildBrandVoiceBlock,
  buildCampaignBriefBlock,
  buildGuidelinesBlock,
  buildPositioningBlock,
} from "./brand-voice";
import { buildEmailDesignBrief } from "./email-design";

// Zod schema for the model's tool input: structured COPY plus the complete
// designed HTML document (produced under the email design system prompt).
// The copy is kept alongside the HTML so a draft can always be re-rendered
// through a code template if the model's HTML fails validation.
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
    .max(8)
    .describe(
      "1 to 8 body sections, in order (listicle topics may need one per item).",
    ),
  cta_text: z
    .string()
    .describe("The call-to-action button text, in brand voice."),
  cta_url: z
    .string()
    .optional()
    .describe("Destination URL if known from the topic; otherwise omit."),
  html: z
    .string()
    .describe(
      "The complete designed HTML email document following the EMAIL DESIGN SYSTEM exactly.",
    ),
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
    "Return the email for this topic: on-brand plain-text copy fields plus the complete designed HTML document.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Subject line, under 60 characters." },
      preheader: { type: "string", description: "Preview text, under 150 characters." },
      headline: { type: "string", description: "The email's H1: one sharp line." },
      body_sections: {
        type: "array",
        minItems: 1,
        maxItems: 8,
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
      html: {
        type: "string",
        description:
          "The complete designed HTML email document (doctype through </html>) following the EMAIL DESIGN SYSTEM exactly: inline styles, presentation tables, 600px card, hidden preheader, brand header, one CTA button, footer with the literal {$unsubscribe} link.",
      },
    },
    required: ["subject", "preheader", "headline", "body_sections", "cta_text", "html"],
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

/** Builds the offer block from the topic's resolved product row. */
export function buildOfferBlock(ctx: TopicContext): string {
  const p = ctx.product;
  if (!p) {
    // No product row for the slug: fall back to naming it so the model at
    // least knows an offer exists.
    return ctx.topic.maps_to_product
      ? `RELATED OFFER: ${ctx.topic.maps_to_product}`
      : "";
  }
  return [
    `RELATED OFFER: ${p.name}`,
    p.description ? `  What it is: ${p.description}` : "",
    p.deliverables?.length ? `  Includes: ${p.deliverables.join("; ")}` : "",
    p.price_point ? `  Price point: ${p.price_point}` : "",
    p.url ? `  Link: ${p.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Builds the (system, user) message pair for email generation. */
export function buildEmailMessages(
  ctx: TopicContext,
  tokens: BrandTokens,
  opts: {
    brief?: CampaignBrief | null;
    rejection?: { feedback: string; previousSubject: string; previousPreheader: string };
    /** Overrides the topic's auto-resolved layout, e.g. from reject & regenerate. */
    templateOverride?: EmailTemplateId;
  } = {},
): {
  system: string;
  user: string;
} {
  const { topic, brand } = ctx;
  const guidelinesBlock = buildGuidelinesBlock(brand);
  const voiceBlock = buildBrandVoiceBlock(brand, ctx.primaryIcp, "email");
  const positioningBlock = buildPositioningBlock(brand);
  const briefBlock = buildCampaignBriefBlock(opts.brief ?? null);
  const { ctaText } = resolveCta(ctx);
  const templateId = opts.templateOverride ?? resolveEmailTemplateId(topic);
  const designBrief = buildEmailDesignBrief(tokens, templateId);

  const system = [
    `You are the email copywriter AND designer for ${brand.name}. You produce one`,
    "complete marketing email: copy that sounds exactly like the brand, designed as",
    "modern, readable HTML under the design system below.",
    "",
    guidelinesBlock,
    voiceBlock,
    positioningBlock,
    "",
    designBrief,
    "",
    "RULES:",
    "- Write in the brand voice above. Sound human, never like generic AI marketing copy.",
    "- Use the target keyword and the audience's own vocabulary naturally; never keyword-stuff.",
    "- Match the email's call-to-action to the funnel stage (provided below).",
    "- Fill the plain-text copy fields (no markup in them) AND the html field with the",
    "  complete designed document. The copy fields must match the copy inside the HTML.",
    "- Subject under 60 characters; preheader under 150 characters.",
    "- NEVER use em dashes or double-hyphens as punctuation. Use a comma, colon, or period.",
    "- Call the save_email_draft tool with every field filled. Do not write prose, labels,",
    "  or preambles like Subject:. Fill the tool fields directly.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    "Write and design one email.",
    "",
    briefBlock,
    `TITLE: ${topic.title}`,
    topic.target_keyword ? `TARGET KEYWORD: ${topic.target_keyword}` : "",
    topic.intent ? `SEARCH INTENT: ${topic.intent}` : "",
    topic.funnel_stage ? `FUNNEL STAGE: ${topic.funnel_stage}` : "",
    ctaText
      ? `CALL TO ACTION (use this intent, write the button text in brand voice): ${ctaText}`
      : "CALL TO ACTION: a soft invitation to reply or learn more.",
    buildOfferBlock(ctx),
    ctx.product?.url
      ? `CTA URL: use the offer link above when the CTA points at the offer.`
      : `CTA URL: leave blank unless the related offer implies an obvious destination.`,
    ...(opts.rejection
      ? [
          "",
          "REVISION REQUEST: address this feedback in the new version:",
          `FEEDBACK: ${opts.rejection.feedback}`,
          `PREVIOUS SUBJECT WAS: ${opts.rejection.previousSubject}`,
          `PREVIOUS PREHEADER WAS: ${opts.rejection.previousPreheader}`,
          "Write a meaningfully different email that fixes these issues.",
        ]
      : []),
    "",
    "Call save_email_draft with every field filled, including the complete html document.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
