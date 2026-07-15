import "server-only";
import { load } from "cheerio";
import type { Element } from "domhandler";
import { hasDarkModeSupport } from "./preview-mode";

// Deterministic dark-mode repair for model-designed emails.
//
// The generation prompt asks the model to class every text surface (em-heading,
// em-text, …) and restyle those classes inside @media (prefers-color-scheme:
// dark). In practice the model misses elements often enough that dark-mode
// readers get black text on a near-black card. Per this repo's rule that
// prompt compliance is never trusted for guarantees, this module repairs the
// document mechanically: every element whose inline `color` is too dark to
// read on a dark surface, and which the email's own dark-mode CSS does not
// already restyle, gets a generated class plus one appended dark-mode rule
// that lightens it (hue preserved, so brand-colored links stay on-brand).
//
// Applied at fresh generation (model-designed path) and inside commitHtmlEdit,
// so every stored email — including older drafts, on their next edit — ends up
// covered. Idempotent: reruns strip their own previous classes/style block and
// recompute from scratch.

export const DARK_FIX_STYLE_ID = "em-dmfx";
const FIX_CLASS_PREFIX = "em-dmfx-";

/** Below this WCAG relative luminance, text fails AA on the dark card (#1F2026-ish). */
const DARK_TEXT_LUMINANCE = 0.22;
/** Inline backgrounds lighter than this are treated as light surfaces that keep dark text readable. */
const LIGHT_SURFACE_LUMINANCE = 0.5;
/** Lightness floor for repaired colors: readable on near-black, hue preserved. */
const MIN_LIGHTNESS = 0.82;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  navy: "#000080",
  maroon: "#800000",
};

function parseColor(raw: string): Rgb | null {
  const value = raw.trim().toLowerCase();
  const named = NAMED_COLORS[value];
  const v = named ?? value;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Lightens a color to read on a dark surface while keeping its hue (brand links stay brand-tinted). */
function lightened(rgb: Rgb): string {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  const outL = Math.max(l, MIN_LIGHTNESS);
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let out: Rgb;
  if (s === 0) {
    const v = Math.round(outL * 255);
    out = { r: v, g: v, b: v };
  } else {
    const q = outL < 0.5 ? outL * (1 + s) : outL + s - outL * s;
    const p = 2 * outL - q;
    out = {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
  }
  const toHex = (c: number) => c.toString(16).padStart(2, "0");
  return `#${toHex(out.r)}${toHex(out.g)}${toHex(out.b)}`;
}

/**
 * What the email's own dark-mode CSS already restyles, reduced to the subject
 * (rightmost simple selector) of every rule that declares the property. A
 * rule like `.em-text p { color: … }` marks tag `p` covered; `.em-heading {…}`
 * marks class `em-heading`. Deliberately loose — matching an element against
 * a subject token is enough to say "the model handled this one; hands off."
 */
interface Coverage {
  classes: Set<string>;
  tags: Set<string>;
  universal: boolean;
}

/** Extracts the contents of every @media (prefers-color-scheme: dark) block, brace-balanced. */
function darkMediaBlocks(css: string): string[] {
  const blocks: string[] = [];
  const open = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;
  let match: RegExpExecArray | null;
  while ((match = open.exec(css))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    blocks.push(css.slice(start, depth === 0 ? i - 1 : i));
  }
  return blocks;
}

function coverageFor(css: string, propPattern: RegExp): Coverage {
  const coverage: Coverage = { classes: new Set(), tags: new Set(), universal: false };
  for (const block of darkMediaBlocks(css)) {
    // rule = "selectors { declarations }"
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = rule.exec(block))) {
      if (!propPattern.test(m[2])) continue;
      for (const selector of m[1].split(",")) {
        // The subject is the rightmost simple selector — the element the rule lands on.
        const subject = selector.trim().split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
        if (!subject) continue;
        if (subject.includes("*")) coverage.universal = true;
        for (const cls of subject.matchAll(/\.([\w-]+)/g)) coverage.classes.add(cls[1]);
        const tag = /^[a-z][\w-]*/i.exec(subject);
        if (tag) coverage.tags.add(tag[0].toLowerCase());
      }
    }
  }
  return coverage;
}

// "color:" but never "background-color:"; and any background declaration.
const COLOR_DECL = /(?:^|[;\s])color\s*:/i;
const BACKGROUND_DECL = /(?:^|[;\s])background(?:-color)?\s*:/i;

/** Reads one CSS property's value out of an inline style attribute. */
function inlineValue(style: string, prop: "color" | "background-color" | "background"): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i");
  const m = re.exec(style);
  return m ? m[1].trim() : null;
}

/**
 * Repairs a generated email so no text is left dark-on-dark in dark mode.
 * Returns the html unchanged when it carries no dark-mode CSS at all (nothing
 * forces dark, so there is nothing to repair against).
 */
export function ensureDarkModeReadability(html: string): string {
  if (!hasDarkModeSupport(html)) return html;

  const $ = load(html);

  // Rerun-safety: drop any previous repair before recomputing.
  $(`style#${DARK_FIX_STYLE_ID}`).remove();
  $("[class]").each((_, el) => {
    const node = $(el);
    const classes = (node.attr("class") ?? "").split(/\s+/).filter(Boolean);
    const kept = classes.filter((c) => !c.startsWith(FIX_CLASS_PREFIX));
    if (kept.length !== classes.length) {
      if (kept.length) node.attr("class", kept.join(" "));
      else node.removeAttr("class");
    }
  });

  const css = $("style")
    .map((_, el) => $(el).text())
    .get()
    .join("\n");
  const colorCovered = coverageFor(css, COLOR_DECL);
  const backgroundCovered = coverageFor(css, BACKGROUND_DECL);

  const isCovered = (el: Element, coverage: Coverage): boolean => {
    if (coverage.universal) return true;
    if (el.type !== "tag") return false;
    if (coverage.tags.has(el.name.toLowerCase())) return true;
    const classAttr = el.attribs?.class ?? "";
    return classAttr.split(/\s+/).some((c) => c && coverage.classes.has(c));
  };

  /**
   * Whether this element sits on a surface that stays light in dark mode: the
   * nearest self-or-ancestor inline background that the dark CSS does not
   * override. Dark text there is correct and must not be lightened (think
   * black label on a white button, or copy in a cream callout box).
   */
  const onUncoveredLightSurface = (start: Element): boolean => {
    let node: Element | null = start;
    while (node && node.type === "tag") {
      const style = node.attribs?.style ?? "";
      const bg = inlineValue(style, "background-color") ?? inlineValue(style, "background");
      if (bg) {
        if (isCovered(node, backgroundCovered)) return false;
        const rgb = parseColor(bg);
        // Unparseable (gradient/image) backgrounds are assumed to persist into
        // dark mode: leaving the text alone is the status quo, never worse.
        if (!rgb) return true;
        return luminance(rgb) > LIGHT_SURFACE_LUMINANCE;
      }
      node = node.parent && node.parent.type === "tag" ? node.parent : null;
    }
    return false;
  };

  // One generated class per distinct replacement color.
  const classByColor = new Map<string, string>();

  $("body *").each((_, el) => {
    if (el.type !== "tag") return;
    const style = el.attribs?.style ?? "";
    if (!style) return;
    const colorValue = inlineValue(style, "color");
    if (!colorValue) return;
    const rgb = parseColor(colorValue);
    if (!rgb || luminance(rgb) >= DARK_TEXT_LUMINANCE) return;
    if (isCovered(el, colorCovered)) return;
    if (onUncoveredLightSurface(el)) return;

    const replacement = lightened(rgb);
    let cls = classByColor.get(replacement);
    if (!cls) {
      cls = `${FIX_CLASS_PREFIX}${classByColor.size}`;
      classByColor.set(replacement, cls);
    }
    $(el).addClass(cls);
  });

  if (classByColor.size === 0) return html;

  const rules = Array.from(classByColor.entries())
    .map(([color, cls]) => `.${cls}{color:${color} !important;}`)
    .join("");
  // Appended last so it wins specificity ties against the model's own block.
  $("head").append(
    `<style id="${DARK_FIX_STYLE_ID}">@media (prefers-color-scheme:dark){${rules}}</style>`,
  );

  return $.html();
}
