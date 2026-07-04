import type { BrandTokens } from "@/lib/email/templates/types";
import type { EmailTemplateId } from "@/lib/db/types";

// The codified email design system: every generated email is designed under
// this brief. It encodes the constraints email clients actually impose (email
// HTML is not browser HTML) so "modern" never breaks in Outlook or Gmail, and
// it injects the brand's real tokens so the design is the brand's, not generic.
//
// The model designs the full HTML; code-level guarantees (unsubscribe tag,
// em-dash strip, validation with template fallback) live in lib/pipeline.

const LAYOUT_SHAPES: Record<EmailTemplateId, string> = {
  newsletter_tip:
    "QUICK TIP layout: an uppercase accent eyebrow (e.g. QUICK TIP), one sharp headline, " +
    "the tip set in a visually distinct callout (soft background, accent left border, " +
    "rounded right corners), then the CTA button. Short and punchy; one body section.",
  newsletter_feature:
    "EDITORIAL FEATURE layout: an uppercase accent eyebrow, a larger headline, a lead " +
    "paragraph set bigger and lighter than body text, then 2 to 3 sections each with a " +
    "small bold subheading, separated by thin hairline dividers, then the CTA button.",
  newsletter_howto:
    "STEP-BY-STEP layout: an uppercase accent eyebrow, one headline, a short lead-in, " +
    "then numbered steps where each number sits in a small accent-colored circle or badge " +
    "beside a bold step title and its body copy, then the CTA button.",
};

/**
 * Builds the email design brief for the generation system prompt: layout
 * direction for this email's shape plus the hard email-HTML rules and the
 * brand's visual tokens.
 */
export function buildEmailDesignBrief(
  tokens: BrandTokens,
  templateId: EmailTemplateId,
): string {
  const c = tokens.colors;
  const f = tokens.fonts;
  const footer = tokens.footer;

  return [
    "EMAIL DESIGN SYSTEM (follow exactly; email HTML is not browser HTML):",
    "",
    "Structure:",
    "- Produce ONE complete HTML document: <!DOCTYPE html>, <html>, <head> with",
    "  <meta charset> + viewport meta + <title>, and <body>.",
    "- Immediately inside <body>, a hidden preheader div (display:none;max-height:0;",
    "  overflow:hidden) containing the preheader text, padded with repeated",
    "  '&#847;&zwnj;&nbsp;' so body copy never leaks into the inbox preview line.",
    "- Layout with nested <table role=\"presentation\"> elements (Outlook-safe), never",
    "  CSS grid, flexbox, floats, or position.",
    "- One centered single-column card, width 600px (max-width:600px), rounded corners,",
    "  on a soft neutral page background (#EEF1F6 works well), generous outer padding.",
    "- A 5px accent-colored top bar on the card gives it brand presence.",
    "",
    "CSS rules:",
    "- ALL styles inline on elements. No external stylesheets, no <link>, no JavaScript,",
    "  no web-font imports (brand font stacks below are already email-safe).",
    "- An optional single <style> block in <head> may ONLY hold @media tweaks for mobile;",
    "  the email must look correct even if that block is stripped.",
    "- Images: only the brand logo if a URL is provided; always with alt text. Never",
    "  reference other external images.",
    "",
    "Readability (non-negotiable):",
    "- Body copy 16px, line-height 1.6 to 1.7, never wider than the 600px column with",
    "  at least 40px side padding inside the card.",
    "- Clear hierarchy: ONE headline (28 to 32px, tight letter-spacing), scannable",
    "  sections, short paragraphs (1 to 3 sentences each).",
    "- Exactly ONE dominant call-to-action: a bulletproof button, an <a> styled",
    "  display:inline-block with the accent background, white text, 15px+ vertical",
    "  padding, rounded corners. Text links may support it; nothing competes with it.",
    "- Color contrast must stay comfortably readable (body text on background at",
    "  WCAG-AA-level contrast or better).",
    "",
    "Required chrome:",
    tokens.logo_url
      ? `- Header: the brand logo <img src="${tokens.logo_url}" alt="${tokens.logo_alt}"> capped at max-width:170px;max-height:48px, above a 1px hairline divider.`
      : `- Header: a typographic wordmark, "${tokens.logo_alt}" in the heading font, bold, with a period after it colored in the accent, above a 1px hairline divider.`,
    "- Footer, centered, small muted text above a hairline top border: the sender name" +
      (footer.website ? ` linked to ${footer.website}` : "") +
      (footer.contact_email ? `, the contact email ${footer.contact_email}` : "") +
      ", and REQUIRED: an unsubscribe link whose href is the literal merge tag {$unsubscribe}.",
    "",
    "BRAND TOKENS (the default palette; use these exact values UNLESS the",
    "instruction below explicitly asks for a different color, tone, or look",
    "for this piece, in which case follow that explicit request instead):",
    `- Primary (headlines, wordmark): ${c.primary}`,
    `- Secondary (lead paragraph): ${c.secondary}`,
    `- Accent (top bar, eyebrow, CTA button, highlights): ${c.accent}`,
    `- Card background: ${c.background}`,
    `- Body text: ${c.text}`,
    `- Muted (footer, meta): ${c.muted}`,
    `- Heading font stack: ${f.heading}`,
    `- Body font stack: ${f.body}`,
    "",
    "LAYOUT FOR THIS EMAIL:",
    `- ${LAYOUT_SHAPES[templateId]}`,
    "",
    "Design taste: modern and confident, generous whitespace, accent used sparingly",
    "and deliberately. Never cram; when in doubt, add space. NEVER use em dashes or",
    "en dashes anywhere in the HTML or copy.",
  ].join("\n");
}
