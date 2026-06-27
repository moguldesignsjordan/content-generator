import { z } from "zod";
import type { EmailDraftContent, TopicContext } from "@/lib/db/types";
import { buildBrandVoiceBlock } from "./brand-voice";

// Structured-output schema: guarantees the model returns exactly these fields
// (no scraping free text). Length limits are instructed in the prompt — JSON
// Schema can't enforce maxLength, so the QA pass (Slice 6) will verify them.
export const EmailDraftSchema = z.object({
  subject: z.string().describe("Email subject line, under 60 characters."),
  preheader: z
    .string()
    .describe("Preview text shown after the subject, under 150 characters."),
  html_body: z
    .string()
    .describe(
      "The full email body as clean, inline-styled, responsive HTML. " +
        "Must include the literal {$unsubscribe} merge tag in the footer.",
    ),
});

export type EmailDraftOutput = z.infer<typeof EmailDraftSchema>;

/**
 * Resolves the call-to-action for a topic by its funnel stage:
 *   topic.funnel_stage → strategy.funnel_definition[stage].cta_type
 *                      → brand.voice_profile.cta_library[cta_type]
 */
export function resolveCta(ctx: TopicContext): { ctaType: string | null; ctaText: string | null } {
  const stage = ctx.topic.funnel_stage;
  if (!stage) return { ctaType: null, ctaText: null };

  const ctaType = ctx.strategy.funnel_definition?.[stage]?.cta_type ?? null;
  const ctaText = ctaType
    ? ctx.brand.voice_profile?.cta_library?.[ctaType] ?? null
    : null;

  return { ctaType, ctaText };
}

/** Builds the (system, user) message pair for email generation. */
export function buildEmailMessages(
  ctx: TopicContext,
  rejectionContext?: { feedback: string; previousDraft: EmailDraftContent },
): {
  system: string;
  user: string;
} {
  const { topic, brand } = ctx;
  const voiceBlock = buildBrandVoiceBlock(brand, ctx.primaryIcp);
  const { ctaText } = resolveCta(ctx);
  const senderName =
    (brand.mailerlite_config?.sender_name as string | undefined) ?? brand.name;

  const system = [
    `You are the email copywriter for ${brand.name}. You write a single marketing`,
    "email that sounds exactly like the brand and serves its strategy.",
    "",
    voiceBlock,
    "",
    "RULES:",
    "- Write in the brand voice above. Sound human, never like generic AI marketing copy.",
    "- Use the target keyword and the audience's own vocabulary naturally — never keyword-stuff.",
    "- Match the email's call-to-action to the funnel stage (provided below).",
    "- Output clean, inline-styled, responsive HTML (no <style> tags, no external CSS).",
    "  Keep it simple: a single column, system fonts, generous spacing, one clear CTA button or link.",
    "- The HTML MUST include the literal MailerLite merge tag {$unsubscribe} as an",
    "  unsubscribe link in the footer — MailerLite rejects campaigns without it.",
    `- Sign off as ${senderName}.`,
    "- Subject under 60 characters; preheader under 150 characters.",
    "- NEVER use em dashes (— or --). Use a comma, colon, or period instead.",
  ].join("\n");

  const user = [
    "Write one email for this topic:",
    "",
    `TITLE: ${topic.title}`,
    topic.target_keyword ? `TARGET KEYWORD: ${topic.target_keyword}` : "",
    topic.intent ? `SEARCH INTENT: ${topic.intent}` : "",
    topic.funnel_stage ? `FUNNEL STAGE: ${topic.funnel_stage}` : "",
    ctaText
      ? `CALL TO ACTION (use this intent, write it in brand voice): ${ctaText}`
      : "CALL TO ACTION: a soft invitation to reply or learn more.",
    topic.maps_to_product ? `RELATED OFFER: ${topic.maps_to_product}` : "",
    ...(rejectionContext
      ? [
          "",
          "REVISION REQUEST — address this feedback in the new version:",
          `FEEDBACK: ${rejectionContext.feedback}`,
          `PREVIOUS SUBJECT WAS: ${rejectionContext.previousDraft.subject}`,
          `PREVIOUS PREHEADER WAS: ${rejectionContext.previousDraft.preheader}`,
          "Write a meaningfully different email that fixes these issues.",
        ]
      : []),
    "",
    "Return the subject, preheader, and the HTML body.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
