import "server-only";
import type { EmailTemplate } from "./types";
import {
  escapeHtml,
  paragraphs,
  renderCtaButton,
  renderEyebrow,
  renderShell,
} from "./shared";

// Scannable digest: an eyebrow, a short intro line, then each body section as
// a numbered compact item (bold lead-in via the section heading, one
// supporting sentence via the body). Not narrative, built to skim.
export const digest: EmailTemplate = {
  id: "digest",
  label: "Digest",
  description: "A scannable, numbered roundup of short items.",
  render: ({ copy, tokens }) => {
    const c = tokens.colors;

    const [first, ...rest] = copy.body_sections;
    const hasIntro = Boolean(first && !first.heading);
    const intro = hasIntro && first ? paragraphs(first.body, c.text) : "";
    const itemSource = hasIntro ? rest : copy.body_sections;

    const items = itemSource
      .map((s, i) => {
        const badge =
          `<td valign="top" style="width:30px;padding-right:12px;">` +
          `<div style="width:26px;height:26px;border-radius:50%;background:${c.accent};` +
          `color:#ffffff;font-family:${tokens.fonts.body};font-weight:700;font-size:13px;` +
          `text-align:center;line-height:26px;">${i + 1}</div></td>`;
        const heading = s.heading
          ? `<div style="font-family:${tokens.fonts.heading};font-weight:700;font-size:16px;` +
            `color:${c.primary};margin:2px 0 4px;">${escapeHtml(s.heading)}</div>`
          : "";
        return (
          `<tr><td style="padding:0 0 18px;">` +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
          `<tr>${badge}<td valign="top">${heading}${paragraphs(s.body, c.text)}</td></tr></table>` +
          `</td></tr>`
        );
      })
      .join("");

    const inner =
      renderEyebrow("Roundup", tokens) +
      `<h1 data-region="headline" class="em-heading" style="margin:0 0 18px;font-family:${tokens.fonts.heading};` +
      `font-size:28px;line-height:1.22;letter-spacing:-0.4px;color:${c.primary};">` +
      `${escapeHtml(copy.headline)}</h1>` +
      intro +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>` +
      renderCtaButton(copy.cta_text, copy.cta_url, tokens);

    return renderShell(tokens, inner, { preheader: copy.preheader });
  },
};
