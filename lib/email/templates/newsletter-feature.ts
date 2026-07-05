import "server-only";
import type { EmailTemplate } from "./types";
import {
  escapeHtml,
  leadParagraph,
  paragraphs,
  renderCtaButton,
  renderDivider,
  renderEyebrow,
  renderShell,
} from "./shared";

// Editorial feature: kicker + large headline, an intro lead, then 2 to 3
// subheaded sections separated by hairline dividers. Best for deeper topics.
export const newsletterFeature: EmailTemplate = {
  id: "newsletter_feature",
  label: "Newsletter: Feature",
  description: "A longer editorial with an intro and 2 to 3 subheaded sections.",
  render: ({ copy, tokens }) => {
    const c = tokens.colors;

    // First section, when it has no heading, becomes the editorial lead.
    const [first, ...rest] = copy.body_sections;
    const hasLead = first && !first.heading;
    const lead = hasLead
      ? first.body
          .split(/\n\s*\n/)
          .map((p, i) =>
            i === 0 ? leadParagraph(p.trim(), tokens) : paragraphs(p, c.text),
          )
          .join("")
      : "";
    const sectionSource = hasLead ? rest : copy.body_sections;

    const sections = sectionSource
      .map((s, i) => {
        const divider = i === 0 && !hasLead ? "" : renderDivider();
        const heading = s.heading
          ? `<h2 style="margin:0 0 14px;font-family:${tokens.fonts.heading};` +
            `font-size:21px;line-height:1.3;letter-spacing:-0.2px;color:${c.primary};">` +
            `${escapeHtml(s.heading)}</h2>`
          : "";
        return divider + heading + paragraphs(s.body, c.text);
      })
      .join("");

    const inner =
      renderEyebrow("Feature", tokens) +
      `<h1 data-region="headline" style="margin:0 0 22px;font-family:${tokens.fonts.heading};` +
      `font-size:32px;line-height:1.2;letter-spacing:-0.5px;color:${c.primary};">` +
      `${escapeHtml(copy.headline)}</h1>` +
      lead +
      sections +
      renderCtaButton(copy.cta_text, copy.cta_url, tokens);

    return renderShell(tokens, inner, { preheader: copy.preheader });
  },
};
