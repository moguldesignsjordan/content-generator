import "server-only";
import type { EmailTemplate, BrandTokens, ShowcaseProduct } from "./types";
import type { ContentImage, EmailCopySection, EmailStyleId } from "@/lib/db/types";
import {
  escapeHtml,
  onColor,
  renderDarkModeStyle,
  renderFooter,
  renderPreheader,
} from "./shared";

const PAGE_BG = "#F5F5F5";
const SOFT_BG = "#F4F4F5";

// One layout, several looks. The look comes from the draft's rotated
// EmailStyleId (prompts/email-styles.ts), so a campaign never repeats a look
// back to back and a regenerated draft keeps its own. Each look is loosely
// named after its style so a vibe picked in the chat still means something.
interface ShowcaseLook {
  align: "center" | "left";
  imageFirst: boolean;
  panel: "dark" | "accent" | "outline" | "tint";
  benefit: "rule" | "card" | "plain";
  corners: "round" | "soft" | "sharp";
  topBar: number;
}

const LOOKS: Record<EmailStyleId, ShowcaseLook> = {
  // The original design, and the default.
  soft_card: { align: "center", imageFirst: false, panel: "dark", benefit: "rule", corners: "round", topBar: 6 },
  pill_modern: { align: "center", imageFirst: true, panel: "accent", benefit: "card", corners: "round", topBar: 0 },
  warm_gradient_top: { align: "center", imageFirst: false, panel: "tint", benefit: "rule", corners: "soft", topBar: 12 },
  bold_accent_band: { align: "left", imageFirst: false, panel: "accent", benefit: "card", corners: "sharp", topBar: 12 },
  minimal_mono: { align: "left", imageFirst: false, panel: "outline", benefit: "plain", corners: "soft", topBar: 0 },
  editorial_serif: { align: "center", imageFirst: true, panel: "outline", benefit: "plain", corners: "sharp", topBar: 0 },
  bordered_ledger: { align: "left", imageFirst: true, panel: "dark", benefit: "card", corners: "sharp", topBar: 6 },
  left_rule_editorial: { align: "left", imageFirst: false, panel: "dark", benefit: "rule", corners: "soft", topBar: 6 },
};

const RADII = {
  round: { card: 24, panel: 18, button: 999, image: 18 },
  soft: { card: 14, panel: 12, button: 10, image: 12 },
  sharp: { card: 4, panel: 4, button: 4, image: 4 },
};

type Radii = (typeof RADII)[ShowcaseLook["corners"]];

/** The accent mixed toward white, for the light "tint" panel. */
function tint(hex: string, amount = 0.88): string {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return SOFT_BG;
  const mix = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * amount).toString(16).padStart(2, "0");
  };
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

// Head CSS can't be inlined, so mobile sizing and the soft-card dark surface
// live here. Clients that drop <style> keep the desktop light layout, which
// still fits at 100% width.
const SHOWCASE_STYLE =
  `<style>` +
  `@media (prefers-color-scheme:dark){.sc-soft{background:#2A2B31 !important;}}` +
  `@media only screen and (max-width:600px){` +
  `.sc-wrap{padding:12px 8px !important;}` +
  `.sc-pad{padding-left:22px !important;padding-right:22px !important;}` +
  `.sc-title{font-size:40px !important;letter-spacing:-1.5px !important;}` +
  `.sc-copy{font-size:15px !important;}` +
  `.sc-stack{display:block !important;width:100% !important;box-sizing:border-box !important;}` +
  `.sc-stack-btn{padding:0 26px 25px !important;text-align:left !important;}` +
  `.sc-cta{display:block !important;}` +
  `}` +
  `</style>`;

function multiline(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => escapeHtml(p.trim()))
    .filter(Boolean)
    .join("<br><br>");
}

/** The headline with its last word in the accent color, the design's signature. */
function renderHeadline(headline: string, tokens: BrandTokens, align: ShowcaseLook["align"]): string {
  const text = headline.trim();
  // 54px is sized for 3 to 6 words; longer headlines step down so they don't
  // wrap into a wall of display type.
  const size = text.length > 40 ? 40 : 54;
  const split = text.lastIndexOf(" ");
  const lead = split === -1 ? "" : `${escapeHtml(text.slice(0, split))} `;
  const last = split === -1 ? text : text.slice(split + 1);
  return (
    `<h1 data-region="headline" class="em-heading sc-title" style="margin:0;padding:0;text-align:${align};` +
    `color:${tokens.colors.primary};font-family:${tokens.fonts.heading};font-size:${size}px;` +
    `line-height:1.02;letter-spacing:-2.5px;font-weight:800;">` +
    `${lead}<span style="color:${tokens.colors.accent};">${escapeHtml(last)}</span></h1>`
  );
}

function renderLogo(tokens: BrandTokens, align: ShowcaseLook["align"]): string {
  const mark = tokens.logo_url
    ? `<img src="${escapeHtml(tokens.logo_url)}" width="82" alt="${escapeHtml(tokens.logo_alt)}" ` +
      `style="display:block;width:82px;max-width:82px;height:auto;border:0;` +
      `margin:${align === "center" ? "0 auto" : "0"};" />`
    : `<span class="em-heading" style="font-family:${tokens.fonts.heading};font-size:20px;font-weight:800;` +
      `color:${tokens.colors.primary};">${escapeHtml(tokens.logo_alt)}` +
      `<span style="color:${tokens.colors.accent};">.</span></span>`;
  const website = tokens.footer.website;
  const linked = website
    ? `<a href="${escapeHtml(website)}" target="_blank" style="text-decoration:none;border:0;">${mark}</a>`
    : mark;
  return `<tr><td align="${align}" class="sc-pad" style="padding:28px 40px 8px;">${linked}</td></tr>`;
}

function renderImage(image: ContentImage, href: string | null, radii: Radii): string {
  const img =
    `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="520" ` +
    `style="display:block;width:100%;max-width:100%;height:auto;border-radius:${radii.image}px;border:0;" />`;
  const link = image.link_url?.trim() || href;
  const inner = link
    ? `<a href="${escapeHtml(link)}" target="_blank" style="display:block;text-decoration:none;border:0;">${img}</a>`
    : img;
  return `<tr><td data-region="image" class="sc-pad" style="padding:30px 40px 0;">${inner}</td></tr>`;
}

function pillButton(
  text: string,
  href: string,
  tokens: BrandTokens,
  size: "small" | "large",
  radius: number,
  colors: { bg: string; fg: string } = {
    bg: tokens.colors.accent,
    fg: onColor(tokens.colors.accent),
  },
): string {
  const sizing =
    size === "small"
      ? "font-size:11px;padding:12px 14px;text-transform:uppercase;letter-spacing:.5px;"
      : "font-size:16px;padding:17px 34px;box-shadow:0 7px 18px rgba(0,0,0,.12);";
  return (
    `<a href="${escapeHtml(href)}" target="_blank"${size === "large" ? ` class="sc-cta"` : ""} ` +
    `style="display:inline-block;background:${colors.bg};color:${colors.fg};` +
    `font-family:${tokens.fonts.body};line-height:1;font-weight:800;text-decoration:none;` +
    `border-radius:${radius}px;${sizing}">${escapeHtml(text)}</a>`
  );
}

/** "$45 · 16PT UV coated · Shipping included", escaped and ready to place. */
function factLine(product: ShowcaseProduct): string {
  return ([product.price, ...product.details].filter(Boolean) as string[])
    .map(escapeHtml)
    .join(" &middot; ");
}

/**
 * Panel surfaces. "dark" and "tint" keep their own colors in both schemes
 * (their text is inline and readable either way); "outline" has no fill so
 * its text takes the dark-mode classes like the rest of the card.
 */
function panelColors(look: ShowcaseLook, tokens: BrandTokens) {
  const accent = tokens.colors.accent;
  switch (look.panel) {
    case "accent": {
      const fg = onColor(accent);
      return { bg: accent, border: "none", title: fg, text: fg, label: fg, themed: false, button: { bg: fg, fg: accent } };
    }
    case "tint":
      return { bg: tint(accent), border: "none", title: "#111111", text: "#3F3F46", label: "#111111", themed: false, button: undefined };
    case "outline":
      return { bg: "transparent", border: "1px solid #E6EAF0", title: tokens.colors.primary, text: tokens.colors.secondary, label: accent, themed: true, button: undefined };
    default:
      return { bg: "#171717", border: "none", title: "#FFFFFF", text: "#C4C4C4", label: accent, themed: false, button: undefined };
  }
}

function renderProductPanel(
  product: ShowcaseProduct,
  label: string,
  href: string,
  tokens: BrandTokens,
  look: ShowcaseLook,
  radii: Radii,
): string {
  const p = panelColors(look, tokens);
  const facts = factLine(product);
  const factRow = facts
    ? `<div${p.themed ? ` class="em-text"` : ""} style="color:${p.text};font-family:${tokens.fonts.body};` +
      `font-size:14px;line-height:1.55;">${facts}</div>`
    : "";
  return (
    `<tr><td class="sc-pad" style="padding:28px 40px 0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"` +
    `${p.themed ? ` class="em-border"` : ""} ` +
    `style="width:100%;background:${p.bg};border:${p.border};border-radius:${radii.panel}px;"><tr>` +
    `<td class="sc-stack" style="padding:25px 26px;">` +
    `<div style="color:${p.label};font-family:${tokens.fonts.body};font-size:10px;line-height:1.3;` +
    `font-weight:800;letter-spacing:1.4px;text-transform:uppercase;margin-bottom:8px;">${escapeHtml(label)}</div>` +
    `<div${p.themed ? ` class="em-heading"` : ""} style="color:${p.title};font-family:${tokens.fonts.heading};` +
    `font-size:28px;line-height:1.1;font-weight:800;letter-spacing:-.8px;margin-bottom:9px;">${escapeHtml(product.name)}</div>` +
    factRow +
    `</td>` +
    `<td width="125" align="right" valign="middle" class="sc-stack sc-stack-btn" style="padding:25px 26px 25px 5px;">` +
    pillButton("Shop now \u2192", href, tokens, "small", radii.button, p.button) +
    `</td></tr></table></td></tr>`
  );
}

function renderValueBlock(
  section: EmailCopySection,
  tokens: BrandTokens,
  look: ShowcaseLook,
  radii: Radii,
): string {
  const heading = section.heading
    ? `<div class="em-heading" style="color:${tokens.colors.primary};font-family:${tokens.fonts.heading};` +
      `font-size:20px;line-height:1.25;font-weight:800;margin-bottom:7px;">${escapeHtml(section.heading)}</div>`
    : "";
  const frame =
    look.benefit === "card"
      ? { table: ` class="sc-soft" style="background:${SOFT_BG};border-radius:${radii.panel}px;"`, cell: "padding:20px 22px;", mark: "" }
      : look.benefit === "plain"
        ? {
            table: "",
            cell: "padding:0;",
            mark:
              `<div style="width:28px;height:3px;background:${tokens.colors.accent};` +
              `font-size:0;line-height:0;margin-bottom:12px;">&nbsp;</div>`,
          }
        : { table: ` style="border-left:4px solid ${tokens.colors.accent};"`, cell: "padding:4px 0 4px 18px;", mark: "" };
  return (
    `<tr><td class="sc-pad" style="padding:32px 40px 0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${frame.table}>` +
    `<tr><td style="${frame.cell}">` +
    frame.mark +
    heading +
    `<div class="em-text" style="color:${tokens.colors.secondary};font-family:${tokens.fonts.body};` +
    `font-size:14px;line-height:1.55;">${multiline(section.body)}</div>` +
    `</td></tr></table></td></tr>`
  );
}

// Product showcase: a big two-tone headline, a one-line hero, the product
// photo, a product panel whose facts come from the product row, benefit
// blocks, and a closing question with a CTA. The section order is fixed; the
// styling of each piece comes from the draft's look (see LOOKS).
//
// Section roles: the first section is the hero line (its heading, if any,
// labels the product panel); with 3+ sections a headed last section is the
// closing question; everything between is a benefit block.
export const productShowcase: EmailTemplate = {
  id: "product_showcase",
  label: "Product Showcase",
  description: "A bold product feature with a photo, a product panel, and one CTA.",
  render: ({ copy, tokens, product, image, styleId }) => {
    const c = tokens.colors;
    const look = LOOKS[styleId ?? "soft_card"] ?? LOOKS.soft_card;
    const radii = RADII[look.corners];
    const centered = look.align === "center";
    const sections = copy.body_sections;
    const [hero] = sections;
    const last = sections[sections.length - 1];
    const closing = sections.length >= 3 && last?.heading ? last : null;
    const values = sections.slice(1, closing ? -1 : undefined);
    const href = copy.cta_url?.trim() || product?.url || "#";

    const heroCopy = hero
      ? `<p data-region="body" class="em-lead sc-copy" style="margin:${centered ? "20px 15px 0" : "20px 0 0"};` +
        `text-align:${look.align};color:${c.secondary};` +
        `font-family:${tokens.fonts.body};font-size:16px;line-height:1.6;">${multiline(hero.body)}</p>`
      : "";

    const closingLine = closing ? multiline(closing.body) : product ? factLine(product) : "";

    const imageRow = image ? renderImage(image, href, radii) : "";
    const rows =
      (look.topBar
        ? `<tr><td style="height:${look.topBar}px;background:${c.accent};font-size:0;line-height:0;">&nbsp;</td></tr>`
        : "") +
      renderLogo(tokens, look.align) +
      (look.imageFirst ? imageRow : "") +
      `<tr><td align="${look.align}" class="sc-pad" style="padding:30px 40px 0;">` +
      renderHeadline(copy.headline, tokens, look.align) +
      heroCopy +
      `</td></tr>` +
      (look.imageFirst ? "" : imageRow) +
      (product
        ? renderProductPanel(product, hero?.heading || "Featured", href, tokens, look, radii)
        : "") +
      values.map((s) => renderValueBlock(s, tokens, look, radii)).join("") +
      `<tr><td align="${look.align}" class="sc-pad" style="padding:42px 40px 4px;">` +
      (closing?.heading
        ? `<h2 class="em-heading" style="margin:0 0 9px;color:${c.primary};font-family:${tokens.fonts.heading};` +
          `font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-.7px;">${escapeHtml(closing.heading)}</h2>`
        : "") +
      (closingLine
        ? `<p class="em-lead" style="margin:0 0 23px;color:${c.secondary};font-family:${tokens.fonts.body};` +
          `font-size:14px;line-height:1.55;">${closingLine}</p>`
        : "") +
      `<div data-region="cta">${pillButton(copy.cta_text, href, tokens, "large", radii.button)}</div>` +
      `</td></tr>` +
      `<tr><td class="sc-pad" style="padding:0 40px 40px;">${renderFooter(tokens)}</td></tr>`;

    return (
      `<!DOCTYPE html>` +
      `<html lang="en"><head><meta charset="utf-8" />` +
      `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
      `<meta name="color-scheme" content="light dark" />` +
      `<meta name="supported-color-schemes" content="light dark" />` +
      renderDarkModeStyle(c.accent) +
      SHOWCASE_STYLE +
      `<title>${escapeHtml(copy.subject)}</title></head>` +
      `<body class="em-bg" style="margin:0;padding:0;background:${PAGE_BG};-webkit-font-smoothing:antialiased;">` +
      renderPreheader(copy.preheader) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-bg" ` +
      `style="width:100%;background:${PAGE_BG};">` +
      `<tr><td align="center" class="sc-wrap" style="padding:42px 16px;">` +
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="em-card" ` +
      `style="width:100%;max-width:600px;background:${c.background};border-radius:${radii.card}px;overflow:hidden;` +
      `box-shadow:0 12px 40px rgba(0,0,0,0.08);">` +
      rows +
      `</table></td></tr></table>` +
      `</body></html>`
    );
  },
};
