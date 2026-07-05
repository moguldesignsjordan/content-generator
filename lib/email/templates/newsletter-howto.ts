import "server-only";
import type { EmailTemplate } from "./types";
import {
  escapeHtml,
  paragraphs,
  renderCtaButton,
  renderEyebrow,
  renderShell,
} from "./shared";

// Step-by-step how-to: each body section becomes a numbered step with a
// circular accent badge. Headings become the step label; the body is the
// instruction.
export const newsletterHowto: EmailTemplate = {
  id: "newsletter_howto",
  label: "Newsletter: How-To",
  description: "A numbered, step-by-step walkthrough.",
  render: ({ copy, tokens }) => {
    const c = tokens.colors;

    const steps = copy.body_sections
      .map((s, i) => {
        const badge =
          `<td valign="top" style="width:38px;padding-right:16px;">` +
          `<div style="width:34px;height:34px;border-radius:50%;background:${c.accent};` +
          `color:#ffffff;font-family:${tokens.fonts.body};font-weight:700;font-size:15px;` +
          `text-align:center;line-height:34px;">${i + 1}</div></td>`;
        const heading = s.heading
          ? `<div style="font-family:${tokens.fonts.heading};font-weight:700;font-size:17px;` +
            `color:${c.primary};margin:5px 0 8px;">${escapeHtml(s.heading)}</div>`
          : `<div style="height:5px;line-height:5px;font-size:0;">&nbsp;</div>`;
        const body = paragraphs(s.body, c.text);
        return (
          `<tr><td style="padding:0 0 24px;">` +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
          `<tr>${badge}<td valign="top">${heading}${body}</td></tr></table>` +
          `</td></tr>`
        );
      })
      .join("");

    const inner =
      renderEyebrow("Step by Step", tokens) +
      `<h1 data-region="headline" style="margin:0 0 28px;font-family:${tokens.fonts.heading};` +
      `font-size:30px;line-height:1.22;letter-spacing:-0.4px;color:${c.primary};">` +
      `${escapeHtml(copy.headline)}</h1>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>` +
      renderCtaButton(copy.cta_text, copy.cta_url, tokens);

    return renderShell(tokens, inner, { preheader: copy.preheader });
  },
};
