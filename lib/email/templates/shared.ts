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
    `<p style="margin:0 0 24px;font-size:19px;line-height:1.55;` +
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
  return `<div style="height:1px;line-height:1px;font-size:0;background:#E6EAF0;margin:32px 0;">&nbsp;</div>`;
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
    : `<span style="font-family:${tokens.fonts.heading};font-size:20px;font-weight:700;` +
      `letter-spacing:-0.3px;color:${tokens.colors.primary};">${escapeHtml(tokens.logo_alt)}` +
      `<span style="color:${tokens.colors.accent};">.</span></span>`;

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-region="header">` +
    `<tr><td style="padding:0 0 24px;border-bottom:1px solid #E6EAF0;">${brand}</td></tr>` +
    `</table>`
  );
}

/**
 * Footer: sender sign-off, optional website/social/contact, and the literal
 * {$unsubscribe} merge tag MailerLite requires. The tag is here by construction
 * so a generated email can never be unpublishable.
 */
export function renderFooter(tokens: BrandTokens): string {
  const f = tokens.footer;
  const muted = tokens.colors.muted;
  const website = f.website
    ? `<a href="${escapeHtml(f.website)}" style="color:${tokens.colors.primary};text-decoration:none;font-weight:600;">${escapeHtml(tokens.sender_name)}</a>`
    : `<span style="color:${tokens.colors.primary};font-weight:600;">${escapeHtml(tokens.sender_name)}</span>`;

  const social = f.social ?? {};
  const entries: [string, string | undefined][] = [
    ["LinkedIn", social.linkedin],
    ["Twitter", social.twitter],
    ["Instagram", social.instagram],
    ["YouTube", social.youtube],
  ];
  const socialLinks = entries
    .filter(([, href]) => href)
    .map(
      ([label, href]) =>
        `<a href="${escapeHtml(href as string)}" style="color:${muted};text-decoration:none;margin:0 8px;">${label}</a>`,
    );
  const socialRow = socialLinks.length
    ? `<div style="margin:10px 0;font-size:12px;">${socialLinks.join("")}</div>`
    : "";

  return (
    `<table role="presentation" width="100%" data-region="footer" style="margin-top:40px;padding-top:24px;` +
    `border-top:1px solid #E6EAF0;font-family:${tokens.fonts.body};">` +
    `<tr><td style="text-align:center;color:${muted};font-size:12px;line-height:1.6;">` +
    `<div style="margin:0 0 4px;">${website}</div>` +
    (f.contact_email
      ? `<div style="margin:0 0 4px;"><a href="mailto:${escapeHtml(f.contact_email)}" style="color:${muted};text-decoration:none;">${escapeHtml(f.contact_email)}</a></div>`
      : "") +
    socialRow +
    `<div style="margin:16px 0 0;">` +
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
    `<title>Email</title></head>` +
    `<body style="margin:0;padding:0;background:#EEF1F6;-webkit-font-smoothing:antialiased;">` +
    renderPreheader(opts.preheader ?? "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F6;">` +
    `<tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" ` +
    `style="width:600px;max-width:600px;background:${c.background};border-radius:16px;` +
    `overflow:hidden;border:1px solid #E6EAF0;">` +
    `<tr><td style="height:5px;line-height:5px;font-size:0;background:${c.accent};">&nbsp;</td></tr>` +
    `<tr><td style="padding:40px 44px 44px;font-family:${tokens.fonts.body};color:${c.text};">` +
    renderHeader(tokens) +
    `<div style="padding-top:32px;">${bodyInner}</div>` +
    renderFooter(tokens) +
    `</td></tr>` +
    `</table></td></tr></table>` +
    `</body></html>`
  );
}
