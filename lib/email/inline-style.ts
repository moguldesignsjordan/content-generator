// Native (no-model) email region editing: locate a specific data-region
// element inside the stored draft HTML by its exact occurrence index, and
// mutate its inline style / visible text deterministically. Deliberately NOT
// server-only: pure string transforms, no secrets, imported directly by
// Vitest. Sibling to hero-image.ts (which does the same kind of
// find-a-region-by-string-scan work for the image block).
//
// Correctness rule this file exists to enforce: a client-sent `snippet`
// (read from the live iframe's el.outerHTML) is browser-normalized —
// attribute order, quoting, entity encoding can all drift from the stored
// HTML string — so it's unsafe as a find-anchor. Locating the Nth
// `data-region="X"` element by scanning the stored string instead yields
// exact offsets that are guaranteed correct, independent of what the client
// echoes back.

export interface StyleChanges {
  color?: string;
  background?: string;
  /** Vertical spacing. Templates space regions with margin, not padding. */
  margin?: string;
  fontSize?: string;
  textAlign?: string;
  fontWeight?: string;
}

const PROP_NAMES: Record<keyof StyleChanges, string> = {
  color: "color",
  background: "background",
  margin: "margin",
  fontSize: "font-size",
  textAlign: "text-align",
  fontWeight: "font-weight",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RegionLocation {
  /** Index of the '<' opening the region element in the source html. */
  start: number;
  /** Index just past the element's closing tag. */
  end: number;
  /** The exact substring html.slice(start, end) — the element's outerHTML. */
  outerHTML: string;
}

/**
 * Finds the (0-based) `occurrence`-th element carrying `data-region="region"`
 * in `html` and returns its exact offsets. Assumes the element doesn't nest
 * its own tag name — true for every region in the templates today (h1/div
 * for headline/eyebrow/cta/body/image, table for header/footer with no
 * nested table inside). Returns null if that occurrence doesn't exist.
 */
export function locateRegion(
  html: string,
  region: string,
  occurrence: number,
): RegionLocation | null {
  if (occurrence < 0) return null;
  const attr = `data-region="${region}"`;

  let searchFrom = 0;
  let attrIdx = -1;
  for (let i = 0; i <= occurrence; i++) {
    attrIdx = html.indexOf(attr, searchFrom);
    if (attrIdx === -1) return null;
    searchFrom = attrIdx + attr.length;
  }

  const start = html.lastIndexOf("<", attrIdx);
  if (start === -1) return null;
  const tag = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(start))?.[1];
  if (!tag) return null;
  const closeTag = `</${tag.toLowerCase()}>`;
  const closeIdx = html.toLowerCase().indexOf(closeTag, start);
  if (closeIdx === -1) return null;
  const end = closeIdx + closeTag.length;
  return { start, end, outerHTML: html.slice(start, end) };
}

/**
 * Sets or replaces one or more CSS properties inside the `style="..."`
 * attribute of `elementHtml`'s OPENING tag only. Adds the attribute if
 * missing. Leaves every other attribute and the inner HTML byte-identical.
 */
export function applyStyleChanges(elementHtml: string, changes: StyleChanges): string {
  const openTagMatch = /^<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/.exec(elementHtml);
  if (!openTagMatch) return elementHtml;
  const openTag = openTagMatch[0];
  const rest = elementHtml.slice(openTag.length);

  const styleAttrMatch = /\sstyle="([^"]*)"/.exec(openTag);
  const declarations = new Map<string, string>();
  if (styleAttrMatch) {
    for (const decl of styleAttrMatch[1].split(";")) {
      const sep = decl.indexOf(":");
      if (sep === -1) continue;
      const key = decl.slice(0, sep).trim().toLowerCase();
      const value = decl.slice(sep + 1).trim();
      if (key && value) declarations.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(changes) as [keyof StyleChanges, string | undefined][]) {
    if (value === undefined || value === "") continue;
    const cssProp = PROP_NAMES[key];
    if (cssProp === "background") {
      // A solid background overrides any prior shorthand/color so the two
      // can't silently disagree.
      declarations.delete("background-color");
    }
    declarations.set(cssProp, value);
  }

  const newStyleValue = Array.from(declarations.entries())
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  const styled = declarations.size ? `${newStyleValue};` : "";

  const newOpenTag = styleAttrMatch
    ? openTag.replace(/\sstyle="[^"]*"/, ` style="${styled}"`)
    : `${openTag.slice(0, -1)} style="${styled}">`;

  return newOpenTag + rest;
}

/** Best-effort readers for pre-filling native controls from an element's current inline style. Not authoritative. */
export function guessStyleValue(elementHtml: string, prop: keyof StyleChanges): string | undefined {
  const cssProp = PROP_NAMES[prop];
  const styleAttrMatch = /\sstyle="([^"]*)"/.exec(elementHtml);
  if (!styleAttrMatch) return undefined;
  const re = new RegExp(`(?:^|;)\\s*${cssProp}\\s*:\\s*([^;]+)`, "i");
  const match = re.exec(styleAttrMatch[1]);
  return match ? match[1].trim() : undefined;
}

/**
 * Replaces the visible text of a located region, deterministically (no
 * model). Regions with a single flat text node (headline, eyebrow) get a
 * straight swap. "body" is re-paragraphed the same way the generator does
 * (blank-line-separated <p> blocks), reusing the first existing <p>'s style
 * so the native edit matches the template's own convention. "cta" swaps only
 * the wrapped <a>'s text, preserving its href/style. Any other structure
 * (nested tags this function doesn't know how to target safely, e.g.
 * header/footer's multi-element layout) returns null rather than risk
 * corrupting markup — callers should fall back to the AI rewrite path.
 */
export function replaceRegionText(
  outerHTML: string,
  region: string,
  newText: string,
): string | null {
  const openTagMatch = /^<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/.exec(outerHTML);
  if (!openTagMatch) return null;
  const openTag = openTagMatch[0];
  const tag = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(openTag)?.[1]?.toLowerCase();
  if (!tag) return null;
  const closeTag = `</${tag}>`;
  if (!outerHTML.toLowerCase().endsWith(closeTag)) return null;
  const inner = outerHTML.slice(openTag.length, outerHTML.length - closeTag.length);

  if (region === "body") {
    const pStyleMatch = /<p\s+style="([^"]*)"/i.exec(inner);
    const pStyle = pStyleMatch?.[1] ?? "margin:0 0 18px;font-size:16px;line-height:1.65;";
    const paragraphs = newText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) return null;
    const rebuilt = paragraphs
      .map((p) => `<p style="${pStyle}">${escapeHtml(p)}</p>`)
      .join("");
    return openTag + rebuilt + outerHTML.slice(outerHTML.length - closeTag.length);
  }

  if (region === "cta") {
    const anchorMatch = /(<a\s[^>]*>)([\s\S]*?)(<\/a>)/i.exec(inner);
    if (!anchorMatch) return null;
    const newInner = inner.replace(anchorMatch[0], `${anchorMatch[1]}${escapeHtml(newText)}${anchorMatch[3]}`);
    return openTag + newInner + outerHTML.slice(outerHTML.length - closeTag.length);
  }

  // Simple regions (headline, eyebrow): only safe to swap wholesale when the
  // inner content has no nested tags of its own.
  if (/<[a-zA-Z]/.test(inner)) return null;
  return openTag + escapeHtml(newText) + outerHTML.slice(outerHTML.length - closeTag.length);
}
