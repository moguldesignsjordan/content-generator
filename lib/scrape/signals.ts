import "server-only";
import * as cheerio from "cheerio";
import type { ColorCandidate, SiteSignals } from "./types";

// Deterministic signal extraction from the homepage: metadata, logo/icon
// candidates, colors, fonts, contact and social links. These are facts Claude
// would otherwise hallucinate, so they're pulled in code and handed to the
// model as CLOSED candidate lists it may only choose from.

const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
// hsl(h, s%, l%) and space-separated hsl(h s% l%). oklch()/lab() are left out:
// converting them needs real color math for a minority of (very modern) sites.
const HSL_RE = /hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?[,\s]+(\d{1,3}(?:\.\d+)?)%[,\s]+(\d{1,3}(?:\.\d+)?)%/g;
const CSS_VAR_COLOR_RE = /--[\w-]+\s*:\s*(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))\b/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;{}]+)/gi;

const GENERIC_FONTS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "inherit", "initial", "unset",
  "-apple-system", "blinkmacsystemfont",
]);

function normalizeHex(raw: string): string | null {
  let h = raw.slice(1).toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return `#${h}`;
}

function rgbToHex(r: number, g: number, b: number): string | null {
  if ([r, g, b].some((n) => n > 255)) return null;
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

function hslToHex(h: number, s: number, l: number): string | null {
  if (h > 360 || s > 100 || l > 100) return null;
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

function countColors(
  css: string,
  source: ColorCandidate["source"],
  into: Map<string, ColorCandidate>,
) {
  const add = (hex: string | null, src: ColorCandidate["source"]) => {
    if (!hex) return;
    const cur = into.get(hex);
    if (cur) {
      cur.count += 1;
      // css-var beats css beats inline as a signal label
      if (src === "css-var") cur.source = "css-var";
    } else {
      into.set(hex, { hex, count: 1, source: src });
    }
  };
  for (const m of css.matchAll(CSS_VAR_COLOR_RE)) add(normalizeHex(m[1]), "css-var");
  for (const m of css.matchAll(HEX_RE)) add(normalizeHex(m[0]), source);
  for (const m of css.matchAll(RGB_RE)) {
    add(rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])), source);
  }
  for (const m of css.matchAll(HSL_RE)) {
    add(hslToHex(Number(m[1]), Number(m[2]), Number(m[3])), source);
  }
}

function collectFonts(css: string, into: Map<string, number>) {
  for (const m of css.matchAll(FONT_FAMILY_RE)) {
    const stack = m[1].trim().replace(/["']/g, "").replace(/\s*!important/i, "");
    const first = stack.split(",")[0]?.trim().toLowerCase();
    if (!first || GENERIC_FONTS.has(first) || first.startsWith("var(")) continue;
    into.set(stack, (into.get(stack) ?? 0) + 1);
  }
}

function absolutize(src: string | undefined, base: URL): string | null {
  if (!src || src.startsWith("data:")) return null;
  try {
    const u = new URL(src, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Extracts deterministic brand signals from the homepage HTML. fetchCss lets
 * the caller supply the (guarded, capped) stylesheet fetcher so this module
 * stays free of fetch policy.
 */
export async function extractSignals(
  homepageHtml: string,
  origin: URL,
  fetchCss: (url: URL) => Promise<string | null>,
): Promise<SiteSignals> {
  const $ = cheerio.load(homepageHtml);

  const meta = (sel: string) => $(sel).attr("content")?.trim() || undefined;
  const site_name = meta('meta[property="og:site_name"]') || $("title").first().text().trim() || undefined;
  const meta_description =
    meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const og_image = absolutize(meta('meta[property="og:image"]'), origin) ?? undefined;

  // Logo <img> candidates, scored: explicit "logo" markers first, then
  // header/nav placement, then a homepage-link image.
  const scored: { url: string; score: number }[] = [];
  $("img").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") ?? $el.attr("data-src");
    const abs = absolutize(src, origin);
    if (!abs) return;
    const hay = [
      src,
      $el.attr("alt"),
      $el.attr("class"),
      $el.attr("id"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    if (hay.includes("logo")) score += 4;
    if ($el.closest("header, nav").length) score += 2;
    if ($el.closest('a[href="/"], a[href="./"]').length) score += 2;
    if (abs.endsWith(".svg")) score += 1;
    if (score > 0) scored.push({ url: abs, score });
  });
  const logo_candidates = [...new Set(
    scored.sort((a, b) => b.score - a.score).map((s) => s.url),
  )].slice(0, 5);

  const icon_candidates = [...new Set(
    $('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')
      .map((_, el) => absolutize($(el).attr("href"), origin))
      .get()
      .filter((u): u is string => !!u),
  )].slice(0, 4);

  // Colors + fonts from inline <style>, style= attributes, and up to two
  // same-origin stylesheets.
  const colors = new Map<string, ColorCandidate>();
  const fonts = new Map<string, number>();

  $("style").each((_, el) => {
    const css = $(el).text();
    countColors(css, "css", colors);
    collectFonts(css, fonts);
  });
  $("[style]").each((_, el) => {
    const css = $(el).attr("style") ?? "";
    countColors(css, "inline", colors);
    collectFonts(css, fonts);
  });

  // Prefer sheets whose names suggest design tokens (root/theme/main/app),
  // then take up to 4: many sites split reset/fonts/tokens across files.
  const tokenish = /root|theme|token|main|app|style|global/i;
  const sheetUrls = $('link[rel="stylesheet"]')
    .map((_, el) => absolutize($(el).attr("href"), origin))
    .get()
    .filter((u): u is string => !!u)
    .filter((u) => new URL(u).origin === origin.origin)
    .sort((a, b) => Number(tokenish.test(b)) - Number(tokenish.test(a)))
    .slice(0, 4);
  for (const sheetUrl of sheetUrls) {
    const css = await fetchCss(new URL(sheetUrl));
    if (css) {
      countColors(css, "css", colors);
      collectFonts(css, fonts);
    }
  }

  const color_candidates = [...colors.values()]
    .sort((a, b) => {
      const varBoost = (c: ColorCandidate) => (c.source === "css-var" ? 1000 : 0);
      return varBoost(b) + b.count - (varBoost(a) + a.count);
    })
    .slice(0, 15);

  const font_candidates = [...fonts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([stack]) => stack)
    .slice(0, 6);

  // Contact + social links (footer included: we read the whole page).
  const emails = [...new Set(
    $('a[href^="mailto:"]')
      .map((_, el) => $(el).attr("href")?.replace(/^mailto:/i, "").split("?")[0].trim())
      .get()
      .filter((e): e is string => !!e && e.includes("@")),
  )].slice(0, 3);

  const social: SiteSignals["social"] = {};
  $("a[href]").each((_, el) => {
    const abs = absolutize($(el).attr("href"), origin);
    if (!abs) return;
    const host = new URL(abs).hostname.replace(/^www\./, "");
    if (host === "linkedin.com" && !social.linkedin) social.linkedin = abs;
    if ((host === "twitter.com" || host === "x.com") && !social.twitter) social.twitter = abs;
    if (host === "instagram.com" && !social.instagram) social.instagram = abs;
    if (host === "youtube.com" && !social.youtube) social.youtube = abs;
  });

  return {
    site_name,
    meta_description,
    og_image,
    logo_candidates,
    icon_candidates,
    color_candidates,
    font_candidates,
    emails,
    social,
  };
}
