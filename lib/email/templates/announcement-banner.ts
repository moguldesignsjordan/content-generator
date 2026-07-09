import "server-only";
import type { EmailTemplate } from "./types";
import {
  escapeHtml,
  paragraphs,
  renderCtaButton,
  renderShell,
} from "./shared";

// Clean, confident announcement: the news stated plainly as the headline, one
// short explanatory paragraph, then the CTA. Minimal decoration, no eyebrow
// (the headline itself carries the news).
export const announcementBanner: EmailTemplate = {
  id: "announcement_banner",
  label: "Announcement",
  description: "A clean, confident announcement with one explanatory paragraph.",
  render: ({ copy, tokens }) => {
    const c = tokens.colors;

    const body = copy.body_sections
      .map((s) => paragraphs(s.body, c.text))
      .join("");

    const inner =
      `<h1 data-region="headline" class="em-heading" style="margin:0 0 22px;font-family:${tokens.fonts.heading};` +
      `font-size:30px;line-height:1.2;letter-spacing:-0.4px;color:${c.primary};">` +
      `${escapeHtml(copy.headline)}</h1>` +
      body +
      renderCtaButton(copy.cta_text, copy.cta_url, tokens);

    return renderShell(tokens, inner, { preheader: copy.preheader });
  },
};
