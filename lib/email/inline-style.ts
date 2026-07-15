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

export interface RegionLocation {
  /** Index of the '<' opening the region element in the source html. */
  start: number;
  /** Index just past the element's closing tag. */
  end: number;
  /** Index just past the element's opening tag — where its inner HTML begins. */
  innerStart: number;
  /** Index of the '<' opening the element's closing tag — where its inner HTML ends. */
  innerEnd: number;
  /** The exact substring html.slice(start, end) — the element's outerHTML. */
  outerHTML: string;
  /** The exact substring html.slice(innerStart, innerEnd) — the element's innerHTML. */
  innerHTML: string;
}

/**
 * Returns the index just past the '>' that closes the tag starting at `from`.
 * Quote-aware, because an attribute value may legally contain '>' (an inline
 * style with a CSS child combinator, a data-uri, a merge tag). Returns -1 if
 * the tag is never closed.
 */
function findTagEnd(html: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i + 1;
  }
  return -1;
}

/**
 * Finds the (0-based) `occurrence`-th element carrying `data-region="region"`
 * in `html` and returns its exact offsets.
 *
 * Depth-aware: it walks forward from the opening tag counting nested opening
 * tags of the SAME name, so a region whose markup nests its own tag (a
 * `<table data-region="header">` containing a layout `<table>`, which
 * model-designed emails do emit) ends at its own closing tag rather than the
 * first one encountered. The naive version of this — stopping at the first
 * `</table>` — spliced edits into the middle of the markup and corrupted the
 * document, so the depth count is load-bearing, not defensive.
 *
 * Comments are skipped wholesale, which matters because Outlook conditional
 * comments (`<!--[if mso]><table>…<![endif]-->`) contain tags that must not
 * count toward depth. Void and self-closing tags never open a level.
 *
 * Returns null if that occurrence doesn't exist or the element is unclosed.
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
  const tag = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(start))?.[1]?.toLowerCase();
  if (!tag) return null;

  const innerStart = findTagEnd(html, start);
  if (innerStart === -1) return null;
  // A self-closing region element has no inner HTML to edit.
  if (html.slice(start, innerStart).trimEnd().endsWith("/>")) return null;

  let depth = 1;
  let i = innerStart;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return null;

    if (html.startsWith("<!--", lt)) {
      const commentEnd = html.indexOf("-->", lt);
      if (commentEnd === -1) return null;
      i = commentEnd + 3;
      continue;
    }

    const closing = /^<\/\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(lt, lt + 32));
    if (closing) {
      const tagEnd = findTagEnd(html, lt);
      if (tagEnd === -1) return null;
      if (closing[1].toLowerCase() === tag) {
        depth--;
        if (depth === 0) {
          return {
            start,
            end: tagEnd,
            innerStart,
            innerEnd: lt,
            outerHTML: html.slice(start, tagEnd),
            innerHTML: html.slice(innerStart, lt),
          };
        }
      }
      i = tagEnd;
      continue;
    }

    const opening = /^<\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(lt, lt + 32));
    if (opening) {
      const tagEnd = findTagEnd(html, lt);
      if (tagEnd === -1) return null;
      if (
        opening[1].toLowerCase() === tag &&
        !html.slice(lt, tagEnd).trimEnd().endsWith("/>")
      ) {
        depth++;
      }
      i = tagEnd;
      continue;
    }

    i = lt + 1;
  }
  return null;
}

/**
 * Replaces the INNER HTML of the located region, leaving every other byte of
 * the document untouched. This is the commit path for inline (contentEditable)
 * editing: the user types on the real rendered element, so what comes back is
 * already the markup they want — paragraphs, links and bold runs intact — and
 * the only job here is to splice it in without disturbing the surrounding
 * document. `innerHtml` MUST already be sanitized by the caller
 * (sanitizeEditedFragment); this function does no escaping of its own.
 *
 * Deliberately a string splice rather than a parse/re-serialize of the whole
 * document: re-serializing would risk rewriting the doctype and Outlook
 * conditional comments elsewhere in the email.
 */
export function replaceRegionInner(
  html: string,
  region: string,
  occurrence: number,
  innerHtml: string,
): { html: string } | { error: string } {
  const located = locateRegion(html, region, occurrence);
  if (!located) {
    return { error: "That section couldn't be found. Refresh and try again." };
  }
  return {
    html: html.slice(0, located.innerStart) + innerHtml + html.slice(located.innerEnd),
  };
}

/**
 * Regions a user may delete outright. Structural regions are excluded on
 * purpose: the footer carries the required {$unsubscribe} merge tag (deleting
 * it would make the draft unpublishable), header/cta hold the email together,
 * and image has its own dedicated remove control. Only repeatable or optional
 * text blocks — body, eyebrow, headline — are deletable here.
 */
export const DELETABLE_REGIONS = ["body", "eyebrow", "headline"] as const;

/** Counts how many elements carry `data-region="region"` in `html`. */
export function countRegion(html: string, region: string): number {
  const attr = `data-region="${region}"`;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = html.indexOf(attr, from);
    if (idx === -1) break;
    count++;
    from = idx + attr.length;
  }
  return count;
}

/**
 * Removes the (0-based) `occurrence`-th `data-region="region"` element from
 * `html`. Sibling to locateRegion: same scan, but instead of returning offsets
 * it splices the element out. Returns the trimmed html, or an error if the
 * occurrence can't be found. Caller is responsible for the allowlist + the
 * "don't delete the last body" guard; this only does the mechanical removal.
 */
export function removeRegion(
  html: string,
  region: string,
  occurrence: number,
): { html: string } | { error: string } {
  const located = locateRegion(html, region, occurrence);
  if (!located) {
    return { error: "That section couldn't be found. Refresh and try again." };
  }
  const next = html.slice(0, located.start) + html.slice(located.end);
  return { html: next };
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

/** Style props that belong on the CTA's <a> button itself, not its wrapper. */
const CTA_BUTTON_PROPS: (keyof StyleChanges)[] = [
  "color",
  "background",
  "fontSize",
  "fontWeight",
];

/**
 * Styles the CTA region, splitting the changes between its two elements: the
 * wrapper (spacing, alignment) and the <a> button inside it (text color, fill,
 * size, weight). Styling only the wrapper — what applyStyleChanges alone did —
 * couldn't change the button at all: its own inline styles kept winning, and a
 * "background" painted the whole row instead of the button.
 */
export function applyCtaStyleChanges(elementHtml: string, changes: StyleChanges): string {
  const wrapper: StyleChanges = {};
  const button: StyleChanges = {};
  for (const [key, value] of Object.entries(changes) as [keyof StyleChanges, string | undefined][]) {
    if (value === undefined || value === "") continue;
    if (CTA_BUTTON_PROPS.includes(key)) button[key] = value;
    else wrapper[key] = value;
  }

  let out = Object.keys(wrapper).length ? applyStyleChanges(elementHtml, wrapper) : elementHtml;
  if (Object.keys(button).length) {
    const anchorIdx = out.search(/<a[\s>]/i);
    if (anchorIdx === -1) {
      // No <a> in this CTA (unusual, but model designs vary): the wrapper is
      // the only element there is.
      return applyStyleChanges(out, button);
    }
    out = out.slice(0, anchorIdx) + applyStyleChanges(out.slice(anchorIdx), button);
  }
  return out;
}

/**
 * Replaces the CTA button's visible label — the text inside its <a> — with
 * escaped plain text, leaving every attribute and the surrounding wrapper
 * byte-identical. This is the no-AI "change the button wording" path: the new
 * label travels as TEXT, never as markup, so the button element (and its
 * display/border-radius/padding styling, which the contentEditable sanitizer
 * would strip) cannot be damaged by a text change. Falls back to replacing the
 * wrapper's inner content when the region has no <a> at all.
 */
export function replaceCtaText(elementHtml: string, text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const anchorIdx = elementHtml.search(/<a[\s>]/i);
  if (anchorIdx !== -1) {
    const openEnd = findTagEnd(elementHtml, anchorIdx);
    if (openEnd === -1) return elementHtml;
    // Anchors cannot nest, so the first closing tag after the opener is ours.
    const closeIdx = elementHtml.toLowerCase().indexOf("</a", openEnd);
    if (closeIdx === -1) return elementHtml;
    return elementHtml.slice(0, openEnd) + escaped + elementHtml.slice(closeIdx);
  }

  const innerStart = findTagEnd(elementHtml, 0);
  const innerEnd = elementHtml.lastIndexOf("</");
  if (innerStart === -1 || innerEnd <= innerStart) return elementHtml;
  return elementHtml.slice(0, innerStart) + escaped + elementHtml.slice(innerEnd);
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
