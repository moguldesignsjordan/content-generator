import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  CampaignBrief,
  ContentImage,
  EmailTemplateId,
  EmailType,
  Product,
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
  subject_variants: z
    .array(z.string())
    .optional()
    .describe(
      "2 alternative subject lines taking a different angle, so the reviewer can pick. Under 60 characters each.",
    ),
  preheader: z
    .string()
    .describe(
      "Preview text shown after the subject, under 150 characters. Extends the subject with new information, never restates it.",
    ),
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
      subject_variants: {
        type: "array",
        items: { type: "string" },
        description:
          "2 alternative subject lines with a different angle (curiosity vs specificity), under 60 characters each.",
      },
      preheader: {
        type: "string",
        description:
          "Preview text, under 150 characters. Extends the subject with NEW information; never restates it.",
      },
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

// Per-type length budgets. email_type is the axis that decides how long an
// email should be (layout and funnel stage are orthogonal: they pick shape and
// CTA). These ranges are injected into the prompt as a hard constraint AND
// enforced after generation (see countEmailWords + the retry in generate.ts),
// so "make sure the email is long enough" is no longer left to the model's
// discretion. Tune here in one place; a future settings form can write through
// this map.
export interface EmailLengthTarget {
  words: [number, number];
  sections: [number, number];
  /** Plain-English shape of the email, injected so the model understands the intent, not just the numbers. */
  directive: string;
}

export const EMAIL_LENGTH_TARGETS: Record<EmailType, EmailLengthTarget> = {
  newsletter: {
    words: [300, 700],
    sections: [2, 5],
    directive:
      "a substantive newsletter. Open with a hook, deliver one genuinely useful idea with enough depth to feel worth reading (examples, the reasoning behind the advice, a concrete takeaway), then a clear CTA. Aim for the middle of the word range and never pad with filler.",
  },
  product: {
    words: [300, 450],
    sections: [2, 3],
    directive:
      "a product spotlight. Lead with the outcome the reader gets, explain what it is and why it matters, give one or two concrete specifics, then a confident CTA to see it. Specifics over adjectives.",
  },
  service: {
    words: [350, 550],
    sections: [3, 4],
    directive:
      "a service pitch. Frame the problem, show how the service solves it and what working together looks like, add proof or specificity, then a CTA to book or learn more.",
  },
  promotional: {
    words: [120, 250],
    sections: [1, 2],
    directive:
      "a short, punchy promotional email. Lead with the offer and the reason to act now, keep copy minimal, and put one dominant CTA above the fold. Brief beats long here.",
  },
  announcement: {
    words: [200, 350],
    sections: [1, 3],
    directive:
      "a clear announcement. Put the news up top, explain why it matters to the reader, and say what to do next. Informative and confident, not salesy.",
  },
};

// Service-y keywords in a product name/description. Agency brands (Mogul
// included) sell services far more often than products, so a mapped offer that
// reads like a service is typed as `service` (its own length budget) rather
// than collapsed into `product`. Soft heuristic; a future product.category
// column replaces it.
const SERVICE_KEYWORDS = [
  "service",
  "audit",
  "call",
  "consult",
  "consulting",
  "session",
  "coaching",
  "workshop",
  "retainer",
  "advisory",
  "strategy",
  "design",
  "development",
];

const PROMO_KEYWORDS = [
  "launch",
  "offer",
  "sale",
  "discount",
  "limited",
  "promot",
  "register",
  "rsvp",
  "webinar",
  "event",
  "enroll",
  "book now",
  "sign up",
];

/**
 * Derives the marketing purpose of an email, deterministically, from the topic
 * and any campaign brief. No model classification: the rule is stable and
 * free. Priority:
 *   1. campaign offer with a commercial angle -> promotional
 *   2. brand-stage topic -> announcement
 *   3. mapped offer -> product (or service, by keyword)
 *   4. otherwise -> newsletter (the recurring default)
 * An explicit content_jobs.email_type value overrides this the way
 * templateOverride already overrides resolveEmailTemplateId.
 */
export function resolveEmailType(
  topic: Topic,
  opts: {
    brief?: CampaignBrief | null;
    product?: Product | null;
    override?: EmailType;
  } = {},
): EmailType {
  const { brief, product, override } = opts;
  if (override) return override;

  const promoHaystack =
    `${brief?.goal ?? ""} ${brief?.angle ?? ""} ${brief?.key_message ?? ""}`.toLowerCase();
  if (
    brief?.offer_slug &&
    PROMO_KEYWORDS.some((k) => promoHaystack.includes(k))
  ) {
    return "promotional";
  }

  if (topic.funnel_stage === "brand") return "announcement";

  if (topic.maps_to_product) {
    const nameHay =
      `${product?.name ?? ""} ${product?.description ?? ""}`.toLowerCase();
    const isService = SERVICE_KEYWORDS.some((k) => nameHay.includes(k));
    return isService ? "service" : "product";
  }

  return "newsletter";
}

/** Word count of an email's body copy (the sections, not the one-line headline). */
export function countEmailWords(
  copy: { body_sections: { body: string }[] },
): number {
  return copy.body_sections.reduce(
    (sum, s) =>
      sum + s.body.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
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
    /** Existing hero image to keep in place across a regeneration. */
    heroImage?: ContentImage;
    /** Honors a job's stored content_jobs.email_type instead of deriving one. */
    emailTypeOverride?: EmailType;
  } = {},
): {
  system: string;
  user: string;
  emailType: EmailType;
} {
  const { topic, brand } = ctx;
  const guidelinesBlock = buildGuidelinesBlock(brand);
  const voiceBlock = buildBrandVoiceBlock(brand, ctx.primaryIcp, "email");
  const positioningBlock = buildPositioningBlock(brand);
  const briefBlock = buildCampaignBriefBlock(opts.brief ?? null);
  const { ctaText } = resolveCta(ctx);
  const emailType = resolveEmailType(topic, {
    brief: opts.brief ?? null,
    product: ctx.product,
    override: opts.emailTypeOverride,
  });
  const length = EMAIL_LENGTH_TARGETS[emailType];
  const templateId = opts.templateOverride ?? resolveEmailTemplateId(topic);
  const designBrief = buildEmailDesignBrief(tokens, templateId, {
    heroImage: opts.heroImage,
  });

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
    "COPY PRINCIPLES:",
    "- Lead with the reader, not the brand: open on their problem or outcome; the",
    "  offer earns its place after. Second person, active voice; cut hedging",
    "  words like 'just', 'we think', 'maybe'.",
    "- One email, one job: a single core idea and a single desired action. Nothing",
    "  competes with the CTA.",
    "- Specificity beats adjectives: concrete numbers, timeframes, and named",
    "  outcomes over 'powerful', 'seamless', 'amazing'.",
    "- Subject lines: front-load the hook in the first 30 to 40 characters (mobile",
    "  truncates), curiosity or specificity over hype. No ALL CAPS, no 'FREE!!!',",
    "  no stacked punctuation or emoji, no misleading claims (spam triggers).",
    "  Include the keyword in the subject or opening paragraph where it fits naturally.",
    "- The preheader complements the subject with new information; restating the",
    "  subject wastes the inbox preview line.",
    "- CTA copy is action plus value ('Get my content plan'), never 'Submit' or",
    "  'Click here' (also required for screen-reader users). Descriptive text on",
    "  every link. No link shorteners; keep total link count modest.",
    "",
    "RULES:",
    "- Write in the brand voice above. Sound human, never like generic AI marketing copy.",
    "- Use the target keyword and the audience's own vocabulary naturally; never keyword-stuff.",
    "- Match the email's call-to-action to the funnel stage (provided below).",
    "- Fill the plain-text copy fields (no markup in them) AND the html field with the",
    "  complete designed document. The copy fields must match the copy inside the HTML.",
    "- Subject under 60 characters (plus 2 subject_variants with different angles);",
    "  preheader under 150 characters.",
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
    `EMAIL TYPE: ${emailType}`,
    `LENGTH FOR THIS EMAIL (required, not optional): ${length.words[0]} to ${length.words[1]} words of body copy across ${length.sections[0]} to ${length.sections[1]} body_sections. This is ${emailType === "promotional" || emailType === "announcement" ? `an ${emailType}` : `a ${emailType}`} email: ${length.directive} The body_sections array must hold ${length.sections[0]} to ${length.sections[1]} entries that together total ${length.words[0]} to ${length.words[1]} words.`,
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

  return { system, user, emailType };
}
