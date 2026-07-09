import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  ContentImage,
  EmailCopy,
  EmailStyleId,
  EmailTemplateId,
  TopicContext,
} from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";
import { buildEmailDesignBrief } from "./email-design";
import { EMAIL_STYLES } from "./email-styles";
import { buildOfferBlock } from "./generate-email";

// Instant full-design regeneration: keeps the copy EXACTLY as already
// written (no drafting, no thinking needed), starts from a blank slate, and
// designs a fresh HTML document under the same design system used at
// generation time, grounded in whatever the brand's CURRENT tokens are.
//
// This is the fix for "my background is stuck black, targeted edits don't
// reach every spot": a design can apply the same color as several different
// literal shades across sections (card bg, panel bg, footer bg...), so a
// find/replace patch can only ever fix ONE at a time. A from-scratch
// redesign reapplies the current tokens consistently everywhere in one
// shot, cheap because there's no copy to invent, just layout to fill in.

export interface RedesignToolInput {
  html: string;
}

export const REDESIGN_TOOL: Anthropic.Tool = {
  name: "save_redesigned_email",
  description:
    "Return the complete HTML document designed for the given copy under " +
    "the email design system.",
  input_schema: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description: "The complete HTML document (doctype through </html>).",
      },
    },
    required: ["html"],
  },
};

/** Builds the (system, user) pair for one redesign call. */
export function buildRedesignMessages(args: {
  copy: EmailCopy;
  tokens: BrandTokens;
  templateId: EmailTemplateId;
  /** Same topic/offer context generation had, so decorative choices (the
   * eyebrow label, any stat highlights pulled from the offer) land the same
   * way each time instead of being freshly invented with less grounding. */
  ctx: TopicContext;
  /** Optional explicit creative override, e.g. "make it darker, use a
   * purple accent instead". When given, this wins over the brand tokens
   * below for whatever it specifies; the tokens remain the default for
   * anything it doesn't mention. */
  direction?: string;
  /** The draft's existing hero image; the redesign keeps it in place. */
  heroImage?: ContentImage;
  /** The draft's existing visual style (meta.email_style_variant); a
   * redesign keeps the same style direction, it's a token/copy resync, not a
   * fresh rotation. Falls back to the safe baseline when unset (older
   * drafts that predate the style library). */
  styleId?: EmailStyleId;
}): { system: string; user: string } {
  const { copy, tokens, templateId, ctx, direction, heroImage, styleId } = args;
  const designBrief = buildEmailDesignBrief(tokens, templateId, {
    heroImage,
    style: styleId ? EMAIL_STYLES[styleId] : undefined,
  });
  const offerBlock = buildOfferBlock(ctx);

  const system = [
    "You are designing the HTML for a marketing email. The copy is FINAL,",
    "already written, do not change a single word of it. Your only job is",
    "the visual design: layout, colors, spacing, typography, exactly",
    "following the design system below using the CURRENT brand tokens as",
    "the default.",
    "",
    designBrief,
    "",
    "RULES:",
    "- Use the copy fields exactly as given, verbatim, in the html.",
    "- Apply the brand tokens CONSISTENTLY as the default: every background,",
    "  panel, divider, and text color in the document should come from the",
    "  token list above, not a mix of old or invented shades.",
    direction
      ? "- EXCEPT: the user gave an explicit creative direction below. Follow" +
        "  it exactly for whatever it specifies, even if that means" +
        "  deliberately departing from a brand token, that's an intentional" +
        "  override for this piece, not a mistake. Use brand tokens only for" +
        "  anything the direction doesn't address."
      : "",
    "- The eyebrow label (if the layout has one) and any decorative",
    "  stat/highlight callouts should be grounded in the offer/topic context",
    "  below, not invented from nothing.",
    "- NEVER use em dashes anywhere in the HTML.",
    "- Call save_redesigned_email once with the complete document.",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyLines = copy.body_sections
    .map((s) => (s.heading ? `HEADING: ${s.heading}\nBODY: ${s.body}` : `BODY: ${s.body}`))
    .join("\n\n");

  const user = [
    "Design the complete HTML email for this exact copy:",
    "",
    `TOPIC: ${ctx.topic.title}`,
    ctx.topic.funnel_stage ? `FUNNEL STAGE: ${ctx.topic.funnel_stage}` : "",
    offerBlock,
    "",
    `SUBJECT: ${copy.subject}`,
    `PREHEADER: ${copy.preheader}`,
    `HEADLINE: ${copy.headline}`,
    "",
    bodyLines,
    "",
    `CTA TEXT: ${copy.cta_text}`,
    copy.cta_url ? `CTA URL: ${copy.cta_url}` : "",
    direction ? `\nCREATIVE DIRECTION (explicit override, follow exactly): ${direction}` : "",
    "",
    "Call save_redesigned_email with the complete document.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
