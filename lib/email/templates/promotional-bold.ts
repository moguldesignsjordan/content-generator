import "server-only";
import type { EmailTemplate } from "./types";
import {
  escapeHtml,
  paragraphs,
  renderCtaButton,
  renderEyebrow,
  renderShell,
} from "./shared";

// Short, punchy promotional email: minimal chrome, one bold offer headline,
// brief copy, one large CTA. Brief beats long for this email type.
export const promotionalBold: EmailTemplate = {
  id: "promotional_bold",
  label: "Promotional: Bold Offer",
  description: "A short, punchy offer email with one dominant call-to-action.",
  render: ({ copy, tokens }) => {
    const c = tokens.colors;

    const body = copy.body_sections
      .map((s) => paragraphs(s.body, c.text))
      .join("");

    const inner =
      renderEyebrow("Limited Time", tokens) +
      `<h1 data-region="headline" class="em-heading" style="margin:0 0 18px;font-family:${tokens.fonts.heading};` +
      `font-size:32px;line-height:1.15;letter-spacing:-0.5px;color:${c.primary};">` +
      `${escapeHtml(copy.headline)}</h1>` +
      body +
      renderCtaButton(copy.cta_text, copy.cta_url, tokens);

    return renderShell(tokens, inner, { preheader: copy.preheader });
  },
};
