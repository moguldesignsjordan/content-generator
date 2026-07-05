import "server-only";
import type { EmailTemplate } from "./types";
import {
  escapeHtml,
  paragraphs,
  renderCtaButton,
  renderEyebrow,
  renderShell,
} from "./shared";

// Short, punchy single-tip email: a kicker, one headline, the tip set in an
// accent-bordered callout so it reads as a deliberate, designed highlight.
export const newsletterTip: EmailTemplate = {
  id: "newsletter_tip",
  label: "Newsletter: Quick Tip",
  description: "A single sharp tip with one clear call-to-action.",
  render: ({ copy, tokens }) => {
    const c = tokens.colors;

    const body = copy.body_sections
      .map((s) => paragraphs(s.body, c.text))
      .join("");

    const callout =
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
      `style="background:#F7F9FC;border-left:4px solid ${c.accent};border-radius:0 12px 12px 0;">` +
      `<tr><td style="padding:24px 28px;">${body}</td></tr></table>`;

    const inner =
      renderEyebrow("Quick Tip", tokens) +
      `<h1 data-region="headline" style="margin:0 0 22px;font-family:${tokens.fonts.heading};` +
      `font-size:30px;line-height:1.22;letter-spacing:-0.4px;color:${c.primary};">` +
      `${escapeHtml(copy.headline)}</h1>` +
      callout +
      renderCtaButton(copy.cta_text, copy.cta_url, tokens);

    return renderShell(tokens, inner, { preheader: copy.preheader });
  },
};
