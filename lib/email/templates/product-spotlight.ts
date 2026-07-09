import "server-only";
import type { EmailTemplate } from "./types";
import {
  escapeHtml,
  leadParagraph,
  paragraphs,
  renderCtaButton,
  renderEyebrow,
  renderShell,
} from "./shared";

// Product/service spotlight: an eyebrow naming the category, an outcome-led
// headline, a lead paragraph, then each body section rendered as a short
// accent-marker feature line rather than a full paragraph block.
export const productSpotlight: EmailTemplate = {
  id: "product_spotlight",
  label: "Product Spotlight",
  description: "An outcome-led headline with a short feature list and CTA.",
  render: ({ copy, tokens }) => {
    const c = tokens.colors;

    const [first, ...rest] = copy.body_sections;
    const hasLead = Boolean(first && !first.heading);
    const lead = hasLead && first ? leadParagraph(first.body.trim(), tokens) : "";
    const featureSource = hasLead ? rest : copy.body_sections;

    const features = featureSource
      .map((s) => {
        const label = s.heading
          ? `<div style="font-family:${tokens.fonts.heading};font-weight:700;font-size:16px;` +
            `color:${c.primary};margin:0 0 4px;">${escapeHtml(s.heading)}</div>`
          : "";
        return (
          `<tr><td style="padding:0 0 20px;">` +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
          `<td valign="top" style="width:22px;padding-right:12px;">` +
          `<div style="width:8px;height:8px;border-radius:50%;background:${c.accent};margin-top:8px;">&nbsp;</div>` +
          `</td><td valign="top">${label}${paragraphs(s.body, c.text)}</td>` +
          `</tr></table></td></tr>`
        );
      })
      .join("");

    const inner =
      renderEyebrow("Spotlight", tokens) +
      `<h1 data-region="headline" class="em-heading" style="margin:0 0 18px;font-family:${tokens.fonts.heading};` +
      `font-size:30px;line-height:1.2;letter-spacing:-0.4px;color:${c.primary};">` +
      `${escapeHtml(copy.headline)}</h1>` +
      lead +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${features}</table>` +
      renderCtaButton(copy.cta_text, copy.cta_url, tokens);

    return renderShell(tokens, inner, { preheader: copy.preheader });
  },
};
