import "server-only";
import type { BrandTokens } from "./types";

/** Escapes user-supplied copy so it can never inject markup into the template. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Normalizes plain-text paragraphs from copy into <p> blocks (blank-line separated). */
export function paragraphs(text: string, color = "inherit"): string {
  const html = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:${color};">${escapeHtml(p)}</p>`,
    )
    .join("");
  return `<div data-region="body">${html}</div>`;
}

/**
 * A larger, lighter intro paragraph that gives the email an editorial "lead".
 * Used for the first paragraph of features and tips.
 */
export function leadParagraph(text: string, tokens: BrandTokens): string {
  return (
    `<p class="em-lead" style="margin:0 0 24px;font-size:19px;line-height:1.55;` +
    `color:${tokens.colors.secondary};font-weight:400;">${escapeHtml(text)}</p>`
  );
}

/** Uppercase brand-accent kicker that labels the email type (e.g. QUICK TIP). */
export function renderEyebrow(text: string, tokens: BrandTokens): string {
  return (
    `<div data-region="eyebrow" style="font-family:${tokens.fonts.body};font-size:12px;font-weight:700;` +
    `letter-spacing:1.6px;text-transform:uppercase;color:${tokens.colors.accent};` +
    `margin:0 0 14px;">${escapeHtml(text)}</div>`
  );
}

/** A thin horizontal rule used to separate sections. */
export function renderDivider(): string {
  return `<div class="em-hairline" style="height:1px;line-height:1px;font-size:0;background:#E6EAF0;margin:32px 0;">&nbsp;</div>`;
}

/**
 * Hidden preview text. Email clients show this after the subject in the inbox.
 * The trailing zero-width/space padding stops body copy from leaking into the
 * preview line.
 */
function renderPreheader(text: string): string {
  if (!text) return "";
  const pad = "&#847;&zwnj;&nbsp;".repeat(40);
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:#F1F5F9;opacity:0;">` +
    `${escapeHtml(text)}${pad}</div>`
  );
}

/**
 * Branded header: the logo if one is set, otherwise a typographic wordmark in
 * the brand heading font with an accent period. Sits above a hairline divider.
 */
export function renderHeader(tokens: BrandTokens): string {
  const brand = tokens.logo_url
    ? `<img src="${escapeHtml(tokens.logo_url)}" alt="${escapeHtml(tokens.logo_alt)}" ` +
      `style="display:inline-block;max-width:170px;max-height:48px;" />`
    : `<span class="em-heading" style="font-family:${tokens.fonts.heading};font-size:20px;font-weight:700;` +
      `letter-spacing:-0.3px;color:${tokens.colors.primary};">${escapeHtml(tokens.logo_alt)}` +
      `<span style="color:${tokens.colors.accent};">.</span></span>`;

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-region="header">` +
    `<tr><td class="em-border" style="padding:0 0 24px;border-bottom:1px solid #E6EAF0;">${brand}</td></tr>` +
    `</table>`
  );
}

/** Strips protocol and trailing slash for a display-friendly domain, e.g. "moguldesignagency.com". */
function displayDomain(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

/**
 * Social row: one circular typographic badge per configured network. Text
 * glyphs in table-cell circles on purpose — no external icon images means
 * nothing to block or break in Gmail/Outlook, and the circles degrade to
 * small squares where border-radius is ignored. Order matches SocialLinks.
 */
export function renderSocialBadges(tokens: BrandTokens): string {
  const social = tokens.footer.social ?? {};
  const muted = tokens.colors.muted;
  const entries: [title: string, glyph: string, href: string | undefined][] = [
    ["LinkedIn", "in", social.linkedin],
    ["X", "X", social.twitter],
    ["Instagram", "ig", social.instagram],
    ["YouTube", "yt", social.youtube],
  ];
  const cells = entries
    .filter(([, , href]) => href)
    .map(
      ([title, glyph, href]) =>
        `<td style="padding:0 5px;">` +
        `<a href="${escapeHtml(href as string)}" title="${title}" class="em-social" ` +
        `style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;` +
        `background:#EEF1F6;color:${muted};font-family:${tokens.fonts.body};font-size:12px;` +
        `font-weight:700;text-align:center;text-decoration:none;">${glyph}</a></td>`,
    );
  if (!cells.length) return "";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 0;">` +
    `<tr>${cells.join("")}</tr></table>`
  );
}

/**
 * Footer: sender wordmark, contact line (domain and email), social badge row,
 * postal address, permission reminder, and the literal {$unsubscribe} merge
 * tag MailerLite requires. The tag is here by construction so a generated
 * email can never be unpublishable.
 */
export function renderFooter(tokens: BrandTokens): string {
  const f = tokens.footer;
  const muted = tokens.colors.muted;

  // Sender wordmark, set in the heading font with the accent period — the
  // header's typographic identity, echoed small.
  const wordmarkInner =
    `<span class="em-heading" style="font-family:${tokens.fonts.heading};font-size:15px;font-weight:700;` +
    `letter-spacing:-0.2px;color:${tokens.colors.primary};">${escapeHtml(tokens.sender_name)}` +
    `<span class="em-accent" style="color:${tokens.colors.accent};">.</span></span>`;
  const wordmark = f.website
    ? `<a href="${escapeHtml(f.website)}" style="text-decoration:none;">${wordmarkInner}</a>`
    : wordmarkInner;

  // One muted contact line: domain and email, dot-separated.
  const contactParts: string[] = [];
  if (f.website) {
    contactParts.push(
      `<a href="${escapeHtml(f.website)}" style="color:${muted};text-decoration:none;">${escapeHtml(displayDomain(f.website))}</a>`,
    );
  }
  if (f.contact_email) {
    contactParts.push(
      `<a href="mailto:${escapeHtml(f.contact_email)}" style="color:${muted};text-decoration:none;">${escapeHtml(f.contact_email)}</a>`,
    );
  }
  const contactRow = contactParts.length
    ? `<div style="margin:6px 0 0;">${contactParts.join(`<span style="padding:0 6px;">&middot;</span>`)}</div>`
    : "";

  return (
    `<table role="presentation" width="100%" data-region="footer" class="em-border" style="margin-top:40px;padding-top:28px;` +
    `border-top:1px solid #E6EAF0;font-family:${tokens.fonts.body};">` +
    `<tr><td class="em-muted" style="text-align:center;color:${muted};font-size:12px;line-height:1.6;">` +
    `<div style="margin:0;">${wordmark}</div>` +
    contactRow +
    renderSocialBadges(tokens) +
    // CAN-SPAM/GDPR: marketing email must carry the sender's physical address.
    (f.postal_address
      ? `<div style="margin:14px 0 0;font-size:11px;">${escapeHtml(f.postal_address)}</div>`
      : "") +
    `<div style="margin:14px 0 0;font-size:11px;">` +
    `You're receiving this email because you subscribed to updates from ${escapeHtml(tokens.sender_name)}.` +
    `</div>` +
    `<div style="margin:8px 0 0;">` +
    `<a href="{$unsubscribe}" style="color:${muted};text-decoration:underline;">Unsubscribe</a>` +
    `</div>` +
    `</td></tr></table>`
  );
}

/** CTA button, accent-colored, generous tap target, with optional helper line. */
export function renderCtaButton(
  text: string,
  url: string | undefined,
  tokens: BrandTokens,
): string {
  const href = url && url.trim() ? url : "#";
  return (
    `<div data-region="cta" style="text-align:center;margin:36px 0 8px;">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;background:${tokens.colors.accent};` +
    `color:#ffffff;font-family:${tokens.fonts.body};font-size:16px;font-weight:600;` +
    `letter-spacing:0.2px;text-decoration:none;padding:15px 36px;border-radius:10px;">` +
    `${escapeHtml(text)}</a>` +
    `</div>`
  );
}

// Neutral dark-scheme palette for automatic dark mode. Brand-agnostic on
// purpose: brand hues stay on the accent (CTA, eyebrow, top bar) which reads
// fine on dark; surfaces and text swap to these. Clients without
// prefers-color-scheme support simply keep the light design.
const DARK = {
  page: "#17181D",
  card: "#1F2026",
  heading: "#F5F6F8",
  lead: "#B9BCC5",
  text: "#D6D8DE",
  muted: "#8E9098",
  hairline: "#33353C",
};

/**
 * Automatic dark mode: declares light+dark support (so clients don't
 * force-invert on their own) and restyles the classed surfaces/text via
 * prefers-color-scheme with !important (the only way head CSS beats the
 * inline styles email requires). The light design is the base; stripping
 * this block leaves a correct light email.
 */
function renderDarkModeStyle(accent: string): string {
  return (
    `<style>` +
    `:root{color-scheme:light dark;supported-color-schemes:light dark;}` +
    `@media (prefers-color-scheme:dark){` +
    `body,.em-bg{background:${DARK.page} !important;}` +
    `.em-card{background:${DARK.card} !important;border-color:${DARK.hairline} !important;}` +
    `.em-heading{color:${DARK.heading} !important;}` +
    `.em-lead{color:${DARK.lead} !important;}` +
    `.em-text,.em-text p{color:${DARK.text} !important;}` +
    `.em-muted,.em-muted a,.em-muted span{color:${DARK.muted} !important;}` +
    // The footer wordmark and its accent period sit inside .em-muted, whose
    // descendant rules above out-rank their own classes; these higher-
    // specificity rules keep them from graying out.
    `.em-muted .em-heading{color:${DARK.heading} !important;}` +
    `.em-muted span.em-accent{color:${accent} !important;}` +
    `.em-hairline{background:${DARK.hairline} !important;}` +
    `.em-border{border-color:${DARK.hairline} !important;}` +
    `.em-social,.em-muted a.em-social{background:${DARK.hairline} !important;color:${DARK.lead} !important;}` +
    `}` +
    `</style>`
  );
}

/**
 * The full HTML document shell: inline styles only, single column, max-width
 * 600px. An accent top bar gives the card brand presence; `bodyInner` is the
 * template-specific content between the header and the footer.
 */
export function renderShell(
  tokens: BrandTokens,
  bodyInner: string,
  opts: { preheader?: string } = {},
): string {
  const c = tokens.colors;
  return (
    `<!DOCTYPE html>` +
    `<html lang="en"><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
    `<meta name="color-scheme" content="light dark" />` +
    `<meta name="supported-color-schemes" content="light dark" />` +
    renderDarkModeStyle(c.accent) +
    `<title>Email</title></head>` +
    `<body class="em-bg" style="margin:0;padding:0;background:#EEF1F6;-webkit-font-smoothing:antialiased;">` +
    renderPreheader(opts.preheader ?? "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-bg" style="background:#EEF1F6;">` +
    `<tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="em-card" ` +
    `style="width:600px;max-width:600px;background:${c.background};border-radius:16px;` +
    `overflow:hidden;border:1px solid #E6EAF0;">` +
    `<tr><td style="height:5px;line-height:5px;font-size:0;background:${c.accent};">&nbsp;</td></tr>` +
    `<tr><td class="em-text" style="padding:40px 44px 44px;font-family:${tokens.fonts.body};color:${c.text};">` +
    renderHeader(tokens) +
    `<div style="padding-top:32px;">${bodyInner}</div>` +
    renderFooter(tokens) +
    `</td></tr>` +
    `</table></td></tr></table>` +
    `</body></html>`
  );
}
