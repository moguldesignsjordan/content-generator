import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  CampaignBrief,
  ContentImage,
  EmailLengthPreference,
  EmailStyleId,
  EmailTemplateId,
  EmailType,
  FeedbackEmailExample,
  Product,
  TopicContext,
  Topic,
} from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import {
  buildBrandVoiceBlock,
  buildCampaignBriefBlock,
  buildGuidelinesBlock,
  buildKeywordLines,
  buildPositioningBlock,
  buildReferenceEmailsBlock,
} from "./brand-voice";
import { buildDesignReferenceBlock, buildEmailDesignBrief } from "./email-design";
import { EMAIL_STYLES, pickEmailStyle, pickRotation } from "./email-styles";

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

// Every known layout id, including the promotional/announcement/spotlight/
// digest shapes added alongside the style library. A topic's distribution
// recipe can name any of these; whichever appears first in the recipe wins
// over automatic resolution (both resolveEmailTemplateId and
// resolveEmailLayout honor this the same way).
const ALL_LAYOUT_IDS: EmailTemplateId[] = [
  "newsletter_tip",
  "newsletter_feature",
  "newsletter_howto",
  "promotional_bold",
  "announcement_banner",
  "product_spotlight",
  "digest",
];

/**
 * Picks the email template for a topic from its distribution recipe only,
 * defaulting to a quick tip. Kept as the simple legacy resolver for callers
 * that don't have an EmailType to route rotation through (e.g. a redesign on
 * a draft that predates email_template_id). Fresh generations should prefer
 * resolveEmailLayout, which adds type-aware rotation on top of this same
 * recipe check.
 */
export function resolveEmailTemplateId(topic: Topic): EmailTemplateId {
  const recipe = topic.distribution_recipe ?? [];
  for (const r of recipe) {
    if ((ALL_LAYOUT_IDS as string[]).includes(r)) return r as EmailTemplateId;
  }
  return "newsletter_tip";
}

// Which layout SHAPES are a fit for each marketing PURPOSE. resolveEmailLayout
// rotates within the matching set instead of always defaulting to the tip
// layout, so most emails no longer share one shape.
const LAYOUT_COMPATIBILITY: Record<EmailType, EmailTemplateId[]> = {
  newsletter: ["newsletter_tip", "newsletter_feature", "newsletter_howto", "digest"],
  product: ["product_spotlight", "newsletter_feature"],
  service: ["product_spotlight", "newsletter_feature"],
  promotional: ["promotional_bold"],
  announcement: ["announcement_banner"],
};

/**
 * Resolves the layout SHAPE for a fresh generation: the topic's distribution
 * recipe still wins when it names a known layout (unchanged behavior); other-
 * wise rotates within the set of shapes compatible with this email's marketing
 * type. `seedIndex` (campaign series) makes the pick deterministic and
 * distinct-by-index; otherwise `recent` (last-used layouts) is excluded so a
 * single stream of generations doesn't repeat.
 */
export function resolveEmailLayout(
  emailType: EmailType,
  topic: Topic,
  opts: { recent?: EmailTemplateId[]; seedIndex?: number } = {},
): EmailTemplateId {
  const recipe = topic.distribution_recipe ?? [];
  for (const r of recipe) {
    if ((ALL_LAYOUT_IDS as string[]).includes(r)) return r as EmailTemplateId;
  }
  const candidates = LAYOUT_COMPATIBILITY[emailType] ?? ["newsletter_tip"];
  return pickRotation(candidates, {
    recent: opts.recent,
    seedIndex: opts.seedIndex,
    avoidLastK: Math.max(1, candidates.length - 1),
  });
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
    words: [80, 160],
    sections: [1, 1],
    directive:
      "a product spotlight with creative-agency energy: fun, confident, and a little witty, never formal or corporate. Exactly ONE punchy paragraph (one body_section, no heading, no second paragraph) that leads with the outcome the reader gets, lands one or two concrete specifics, and hands off to a confident CTA. If a line could open a bank's newsletter, cut it and write something with personality.",
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

/**
 * Applies the brand's email-length preference (Settings → Voice) to the base
 * per-type budget. "short" roughly halves the word range (Jordan's "too many
 * words" lever), "long" stretches it ~30%; both keep the type's shape and
 * intent. The result flows everywhere EMAIL_LENGTH_TARGETS used to: the
 * prompt's hard constraint, the too-short retry, and the QA length check, so
 * the whole pipeline agrees on one target.
 */
export function resolveLengthTarget(
  emailType: EmailType,
  pref: EmailLengthPreference | undefined,
): EmailLengthTarget {
  const base = EMAIL_LENGTH_TARGETS[emailType];
  if (!pref || pref === "standard") return base;

  const scale = pref === "short" ? 0.55 : 1.3;
  const scaled = (n: number) => Math.max(50, Math.round((n * scale) / 10) * 10);
  const words: [number, number] = [scaled(base.words[0]), scaled(base.words[1])];
  // Short emails also drop a section off the ceiling so the budget cut comes
  // from fewer ideas, not the same outline starved of words.
  const sections: [number, number] =
    pref === "short"
      ? [base.sections[0], Math.max(base.sections[0], base.sections[1] - 1)]
      : base.sections;
  const directive =
    base.directive +
    (pref === "short"
      ? " The user prefers SHORT emails: tight and skimmable, every sentence earns its place. Stay near the bottom of the word range and cut anything that does not serve the one core idea."
      : " The user prefers LONGER, meatier emails: use the extra room for depth (examples, reasoning, specifics), never for filler.");

  return { words, sections, directive };
}

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

/**
 * The reviewer's thumbs history, rendered as taste examples. Liked emails are
 * studied for their qualities (never copied); disliked ones become explicit
 * anti-patterns. Empty string when nothing has been rated, so the prompt is
 * unchanged for new accounts.
 */
export function buildFeedbackBlock(examples: FeedbackEmailExample[] | undefined): string {
  if (!examples?.length) return "";
  const liked = examples.filter((e) => e.feedback === "up");
  const disliked = examples.filter((e) => e.feedback === "down");
  const fmt = (e: FeedbackEmailExample) =>
    [
      `- Subject: ${e.subject}${e.email_type ? ` (${e.email_type} email)` : ""}`,
      e.note ? `  Why: ${e.note}` : "",
      e.excerpt ? `  ${e.excerpt.replace(/\n+/g, " ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  return [
    "THE REVIEWER'S TASTE (thumbs they gave past emails; this is direct feedback",
    "on YOUR previous output, weight it heavily):",
    ...(liked.length
      ? [
          "Emails they LIKED. Match what these do (energy, register, structure),",
          "never their content:",
          ...liked.map(fmt),
        ]
      : []),
    ...(disliked.length
      ? [
          "Emails they DISLIKED. Where a Why line is given, that's the reviewer's",
          "own diagnosis, fix exactly that. Where it's missing, infer what went",
          "wrong (too formal, too long, too generic) and do the opposite:",
          ...disliked.map(fmt),
        ]
      : []),
  ].join("\n");
}

/** Builds the (system, user) message pair for email generation. */
export function buildEmailMessages(
  ctx: TopicContext,
  tokens: BrandTokens,
  opts: {
    brief?: CampaignBrief | null;
    rejection?: { feedback: string; previousSubject: string; previousPreheader: string };
    /** Overrides the topic's auto-resolved layout, e.g. reused from
     * meta.email_template_id on regenerate/redesign so a locked draft keeps
     * its shape instead of rotating again. */
    templateOverride?: EmailTemplateId;
    /** Existing hero image to keep in place across a regeneration. */
    heroImage?: ContentImage;
    /** Honors a job's stored content_jobs.email_type instead of deriving one. */
    emailTypeOverride?: EmailType;
    /** Reuses a specific visual style, e.g. from meta.email_style_variant on
     * regenerate/redesign, instead of rotating a fresh one. */
    styleOverride?: EmailStyleId;
    /** Recently-used layouts/styles (most recent first) to avoid repeating.
     * Ignored when seedIndex is given. */
    recentLayouts?: EmailTemplateId[];
    recentStyles?: EmailStyleId[];
    /** Campaign-series position: makes layout + style rotation deterministic
     * and distinct-by-index across the batch instead of reading DB history
     * (parallel per-draft generation calls would otherwise race that read). */
    seedIndex?: number;
    /** Recent thumbs-rated past emails (listFeedbackEmailExamples), injected
     * as liked/disliked taste examples so ratings improve future drafts. */
    feedbackExamples?: FeedbackEmailExample[];
  } = {},
): {
  system: string;
  user: string;
  emailType: EmailType;
  templateId: EmailTemplateId;
  styleId: EmailStyleId;
  lengthTarget: EmailLengthTarget;
} {
  const { topic, brand } = ctx;
  const guidelinesBlock = buildGuidelinesBlock(brand);
  const voiceBlock = buildBrandVoiceBlock(brand, ctx.primaryIcp, "email");
  const positioningBlock = buildPositioningBlock(brand);
  const referenceBlock = buildReferenceEmailsBlock(ctx.referenceEmails);
  const briefBlock = buildCampaignBriefBlock(opts.brief ?? null);
  const { ctaText } = resolveCta(ctx);
  const emailType = resolveEmailType(topic, {
    brief: opts.brief ?? null,
    product: ctx.product,
    override: opts.emailTypeOverride,
  });
  // A length picked for THIS piece in the chat wins over the brand-wide setting.
  const length = resolveLengthTarget(
    emailType,
    opts.brief?.length ?? brand.voice_profile?.email_length,
  );
  const templateId =
    opts.templateOverride ??
    resolveEmailLayout(emailType, topic, {
      recent: opts.recentLayouts,
      seedIndex: opts.seedIndex,
    });
  const styleId =
    opts.styleOverride ??
    pickEmailStyle({
      recent: opts.recentStyles,
      seedIndex: opts.seedIndex,
      vibe: opts.brief?.visual_vibe,
    });
  const designBrief = buildEmailDesignBrief(tokens, templateId, {
    heroImage: opts.heroImage,
    style: EMAIL_STYLES[styleId],
    vibe: opts.brief?.visual_vibe,
  });
  // The text half of the design reference; the screenshot itself is attached to
  // the user turn by the pipeline (loadEmailDesignReference). Empty string when
  // the brand has no email design references, so the prompt is unchanged.
  const designRefBlock = buildDesignReferenceBlock(ctx.emailDesignRefs);

  const system = [
    `You are the email copywriter AND designer for ${brand.name}. You produce one`,
    "complete marketing email: copy that sounds exactly like the brand, designed as",
    "modern, readable HTML under the design system below.",
    "",
    guidelinesBlock,
    voiceBlock,
    positioningBlock,
    referenceBlock,
    buildFeedbackBlock(opts.feedbackExamples),
    "",
    designBrief,
    "",
    designRefBlock,
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
    "- AVOID THE TELLS THAT MARK COPY AS AI-WRITTEN:",
    "  - No 'It's not just X, it's Y' (or 'This isn't about X, it's about Y') constructions.",
    "  - No stacking three short punchy sentences in a row as a rhythm crutch",
    "    ('X. Y. Z.'); vary sentence length so short lines land because they're",
    "    earned, not because they're a pattern.",
    "  - No opening on a rhetorical question ('Ever wonder why...', 'What if I",
    "    told you...') or a scene-setting 'Picture this' / 'Imagine' lead-in.",
    "  - No throat-clearing openers ('In today's fast-paced world', 'Let's face",
    "    it', 'We get it'); start on the actual point.",
    "  - Use contractions naturally (it's, you're, don't); a sentence fragment",
    "    here and there reads more human than a fully grammatical one.",
    "  - One genuinely specific, concrete detail beats three vague superlatives;",
    "    if a line could open literally any brand's email, cut or sharpen it.",
    "- Use the target keyword and the audience's own vocabulary naturally; never keyword-stuff.",
    "- Match the email's call-to-action to the funnel stage (provided below).",
    "- Fill the plain-text copy fields (no markup in them) AND the html field with the",
    "  complete designed document. The copy fields must match the copy inside the HTML.",
    "- The copy fields are PLAIN TEXT: no markdown syntax at all, no **bold**, no ##",
    "  headings, no asterisk bullets. They render literally, so an asterisk stays an",
    "  asterisk. Emphasis belongs in the HTML, as real tags and styles.",
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
    ...buildKeywordLines(topic),
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

  return { system, user, emailType, templateId, styleId, lengthTarget: length };
}
