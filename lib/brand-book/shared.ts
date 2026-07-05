import "server-only";
import { escapeHtml } from "@/lib/email/templates/shared";
import { readableTextColor } from "@/lib/color/contrast";
import type { BrandTokens } from "@/lib/email/templates/types";
import type { BrandBookArgs, CanvasTokens } from "./types";

// Section builders shared by every brand-book template. A template variant is
// just a CanvasTokens set + a bit of flourish CSS (see templates/*.ts); the
// actual section markup and skip-when-empty logic lives here exactly once.

function swatch(hex: string, role: string): string {
  const text = readableTextColor(hex);
  return (
    `<div class="bb-swatch" style="background:${escapeHtml(hex)};color:${text};">` +
    `<span class="bb-swatch-role">${escapeHtml(role)}</span>` +
    `<span class="bb-swatch-hex">${escapeHtml(hex.toUpperCase())}</span>` +
    `</div>`
  );
}

function renderMark(tokens: BrandTokens, canvas: CanvasTokens): string {
  if (tokens.logo_url) {
    return (
      `<img class="bb-mark-img" src="${escapeHtml(tokens.logo_url)}" ` +
      `alt="${escapeHtml(tokens.logo_alt)}" />`
    );
  }
  return (
    `<span class="bb-mark-word" style="color:${canvas.heading};">` +
    `${escapeHtml(tokens.logo_alt)}<span style="color:${tokens.colors.accent};">.</span>` +
    `</span>`
  );
}

export function renderHero(args: BrandBookArgs, canvas: CanvasTokens): string {
  const { brandName, tokens, positioning, guidelines } = args;
  return (
    `<section class="bb-hero">` +
    `<div class="bb-mark">${renderMark(tokens, canvas)}</div>` +
    `<h1 class="bb-h1">${escapeHtml(brandName)}</h1>` +
    (positioning.tagline
      ? `<p class="bb-tagline">${escapeHtml(positioning.tagline)}</p>`
      : "") +
    (guidelines.visual_direction
      ? `<p class="bb-caption">${escapeHtml(guidelines.visual_direction)}</p>`
      : "") +
    `</section>`
  );
}

export function renderStory(args: BrandBookArgs): string {
  const { positioning } = args;
  if (!positioning.business_description && !positioning.differentiators?.length) return "";
  return (
    `<section class="bb-section">` +
    `<div class="bb-eyebrow">Brand story</div>` +
    (positioning.business_description
      ? `<p class="bb-lead">${escapeHtml(positioning.business_description)}</p>`
      : "") +
    (positioning.differentiators?.length
      ? `<ul class="bb-list">${positioning.differentiators
          .map((d) => `<li>${escapeHtml(d)}</li>`)
          .join("")}</ul>`
      : "") +
    `</section>`
  );
}

export function renderLogoSection(args: BrandBookArgs, canvas: CanvasTokens): string {
  const { tokens } = args;
  return (
    `<section class="bb-section">` +
    `<div class="bb-eyebrow">Logo &amp; usage</div>` +
    `<div class="bb-logo-tiles">` +
    `<div class="bb-logo-tile" style="background:#0B0B0F;">${renderMark(
      tokens,
      { ...canvas, heading: "#FAFAFA" },
    )}</div>` +
    `<div class="bb-logo-tile" style="background:#FAFAFA;">${renderMark(
      tokens,
      { ...canvas, heading: "#0B0B0F" },
    )}</div>` +
    `</div>` +
    `<ul class="bb-list bb-usage-rules">` +
    `<li>Keep clear space around the mark, at least the height of one letterform on every side.</li>` +
    `<li>Never stretch, skew, or rotate it.</li>` +
    `<li>Never recolor it outside the palette on this page.</li>` +
    `<li>Don't add drop shadows, outlines, or extra effects.</li>` +
    `<li>Keep it legible at small sizes; don't shrink it past the point of clarity.</li>` +
    `</ul>` +
    `</section>`
  );
}

export function renderColorSection(args: BrandBookArgs): string {
  const { colors } = args.tokens;
  const rows = [
    swatch(colors.primary, "Primary"),
    swatch(colors.secondary, "Secondary"),
    swatch(colors.accent, "Accent"),
    swatch(colors.background, "Background"),
    swatch(colors.text, "Text"),
    swatch(colors.muted, "Muted"),
  ].join("");
  return (
    `<section class="bb-section">` +
    `<div class="bb-eyebrow">Color palette</div>` +
    `<div class="bb-grid-colors">${rows}</div>` +
    `<div class="bb-gradient-caption">Suggested accent gradient</div>` +
    `<div class="bb-gradient" style="background:linear-gradient(115deg, ${colors.primary} 0%, ${colors.accent} 100%);"></div>` +
    `</section>`
  );
}

export function renderTypographySection(args: BrandBookArgs): string {
  const { fonts } = args.tokens;
  return (
    `<section class="bb-section">` +
    `<div class="bb-eyebrow">Typography</div>` +
    `<div class="bb-type-row" style="font-family:${fonts.heading};font-size:56px;font-weight:600;">Display</div>` +
    `<div class="bb-type-row" style="font-family:${fonts.heading};font-size:30px;font-weight:600;">Heading</div>` +
    `<div class="bb-type-row" style="font-family:${fonts.body};font-size:17px;">Body text reads at a comfortable size with generous line height.</div>` +
    `<div class="bb-type-row bb-type-caption" style="font-family:${fonts.body};">Caption &amp; labels</div>` +
    `<p class="bb-type-note">Heading: ${escapeHtml(fonts.heading)}<br/>Body: ${escapeHtml(fonts.body)}</p>` +
    `</section>`
  );
}

function doDontList(doList: string[], dontList: string[]): string {
  const col = (label: string, items: string[], mark: string) =>
    items.length
      ? `<div class="bb-dodont-col"><div class="bb-dodont-label">${label}</div>` +
        `<ul class="bb-dodont-list">${items
          .map((i) => `<li><span class="bb-mark-glyph">${mark}</span>${escapeHtml(i)}</li>`)
          .join("")}</ul></div>`
      : "";
  return `<div class="bb-dodont">${col("Say this", doList, "&#10003;")}${col("Not this", dontList, "&#10007;")}</div>`;
}

export function renderVoiceSection(args: BrandBookArgs): string {
  const g = args.guidelines;
  const hasDoDont = Boolean(g.do_language?.length || g.dont_language?.length);
  if (!g.voice_and_tone && !g.messaging_pillars?.length && !hasDoDont && !g.audience_summary) {
    return "";
  }
  return (
    `<section class="bb-section">` +
    `<div class="bb-eyebrow">Voice &amp; tone</div>` +
    (g.voice_and_tone ? `<p class="bb-lead">${escapeHtml(g.voice_and_tone)}</p>` : "") +
    (g.messaging_pillars?.length
      ? `<div class="bb-pillars">${g.messaging_pillars
          .map((p) => `<span class="bb-pillar">${escapeHtml(p)}</span>`)
          .join("")}</div>`
      : "") +
    (hasDoDont ? doDontList(g.do_language ?? [], g.dont_language ?? []) : "") +
    (g.audience_summary
      ? `<p class="bb-muted-block"><strong>Who this is for.</strong> ${escapeHtml(g.audience_summary)}</p>`
      : "") +
    `</section>`
  );
}

export function renderCtaSection(args: BrandBookArgs): string {
  const { cta_philosophy } = args.guidelines;
  if (!cta_philosophy) return "";
  return (
    `<section class="bb-section">` +
    `<div class="bb-eyebrow">Calls to action</div>` +
    `<p class="bb-lead">${escapeHtml(cta_philosophy)}</p>` +
    `</section>`
  );
}

export function renderFooterSection(args: BrandBookArgs): string {
  const f = args.tokens.footer;
  const social = f.social ?? {};
  const socialEntries = Object.entries(social).filter(([, v]) => v) as [string, string][];
  if (!f.website && !f.contact_email && !socialEntries.length) return "";
  return (
    `<footer class="bb-footer">` +
    (f.website ? `<a href="${escapeHtml(f.website)}" class="bb-footer-link">${escapeHtml(f.website)}</a>` : "") +
    (f.contact_email
      ? `<a href="mailto:${escapeHtml(f.contact_email)}" class="bb-footer-link">${escapeHtml(f.contact_email)}</a>`
      : "") +
    socialEntries
      .map(([label, href]) => `<a href="${escapeHtml(href)}" class="bb-footer-link">${escapeHtml(label)}</a>`)
      .join("") +
    `</footer>`
  );
}

const BASE_CSS = `
*{box-sizing:border-box;}
body{margin:0;-webkit-font-smoothing:antialiased;}
.bb-wrap{max-width:880px;margin:0 auto;padding:0 24px 96px;}
.bb-hero{padding:96px 0 72px;text-align:center;}
.bb-mark{margin-bottom:28px;}
.bb-mark-img{max-height:56px;max-width:220px;}
.bb-mark-word{font-size:22px;font-weight:700;letter-spacing:-0.3px;}
.bb-h1{margin:0 0 14px;font-size:clamp(36px,7vw,64px);font-weight:600;letter-spacing:-0.02em;line-height:1.05;}
.bb-tagline{margin:0 auto 10px;max-width:560px;font-size:19px;line-height:1.5;opacity:0.92;}
.bb-caption{margin:0 auto;max-width:520px;font-size:13px;letter-spacing:0.04em;opacity:0.6;}
.bb-section{padding:56px 0;border-top:1px solid var(--bb-border);}
.bb-eyebrow{margin:0 0 20px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;opacity:0.55;}
.bb-lead{margin:0 0 20px;font-size:19px;line-height:1.6;max-width:680px;}
.bb-list{margin:0;padding-left:20px;font-size:15px;line-height:1.8;}
.bb-usage-rules{margin-top:24px;opacity:0.85;}
.bb-logo-tiles{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.bb-logo-tile{border-radius:var(--bb-radius);padding:40px;display:flex;align-items:center;justify-content:center;min-height:120px;}
.bb-grid-colors{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;}
.bb-swatch{border-radius:var(--bb-radius);padding:20px;min-height:110px;display:flex;flex-direction:column;justify-content:flex-end;gap:4px;}
.bb-swatch-role{font-size:12px;font-weight:600;letter-spacing:0.03em;opacity:0.85;}
.bb-swatch-hex{font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;opacity:0.7;}
.bb-gradient-caption{margin:32px 0 10px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;opacity:0.55;}
.bb-gradient{height:64px;border-radius:var(--bb-radius);}
.bb-type-row{margin:0 0 22px;}
.bb-type-caption{font-size:13px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.6;}
.bb-type-note{margin-top:8px;font-size:13px;line-height:1.7;opacity:0.6;}
.bb-pillars{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 28px;}
.bb-pillar{border-radius:999px;border:1px solid var(--bb-border);padding:8px 16px;font-size:13px;font-weight:600;}
.bb-dodont{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:8px;}
.bb-dodont-label{margin-bottom:10px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;opacity:0.65;}
.bb-dodont-list{margin:0;padding:0;list-style:none;font-size:15px;line-height:1.9;}
.bb-mark-glyph{display:inline-block;width:20px;opacity:0.7;}
.bb-muted-block{margin-top:20px;font-size:14px;line-height:1.7;opacity:0.75;max-width:680px;}
.bb-footer{padding:40px 0 0;display:flex;flex-wrap:wrap;gap:20px;font-size:13px;}
.bb-footer-link{color:inherit;text-decoration:none;opacity:0.65;}
@media (max-width:560px){.bb-dodont,.bb-logo-tiles{grid-template-columns:1fr;}}
`;

export function renderDocumentShell(args: {
  title: string;
  canvas: CanvasTokens;
  tokens: BrandTokens;
  radius: string;
  extraCss?: string;
  bodyInner: string;
}): string {
  const { title, canvas, tokens, radius, extraCss = "", bodyInner } = args;
  return (
    `<!DOCTYPE html>` +
    `<html lang="en"><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>` +
    `:root{--bb-border:${canvas.border};--bb-radius:${radius};}` +
    `body{background:${canvas.background};color:${canvas.body};font-family:${tokens.fonts.body};}` +
    `.bb-hero,.bb-h1{color:${canvas.heading};}` +
    BASE_CSS +
    extraCss +
    `</style></head>` +
    `<body><div class="bb-wrap">${bodyInner}</div></body></html>`
  );
}
