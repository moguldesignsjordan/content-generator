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
  return locateElementAt(html, start);
}

/**
 * Locates the element whose opening tag starts at `start` (which must be the
 * index of its '<'), using the same depth-aware, comment-skipping walk as
 * locateRegion. Returns null for self-closing/unclosed elements.
 */
function locateElementAt(html: string, start: number): RegionLocation | null {
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

/** Block-level tags that can hold a run of copy worth editing. */
const TEXT_BLOCK_TAGS = /^(p|h1|h2|h3|h4|ul|ol|td|div)$/i;
/** Opening tags that mark a candidate as a structural wrapper, not a text leaf. */
const NESTED_BLOCK_RE = /<(p|h1|h2|h3|h4|ul|ol|table|tr|td|div)\b/i;

/**
 * Tags every stray text block with data-region="body" so the whole email is
 * click-to-editable. Model-designed emails routinely leave copy outside the
 * prompted regions (a sign-off line, a P.S., fine print under the CTA), and
 * the inline editor only arms elements carrying data-region — those words were
 * simply dead to the editor. This walks the document, finds block elements
 * that hold visible text but sit outside every existing region, and splices
 * the attribute into their opening tag. Idempotent: a tagged element is a
 * region, so the next pass skips it and everything inside it.
 *
 * Conservative on purpose:
 * - only inside <body>, never the preheader (display:none) or head/style
 * - `td`/`div` only when they are text LEAVES (no nested block elements), so
 *   layout wrappers never become one giant editable region
 * - comment spans (Outlook conditionals) are skipped wholesale
 */
export function ensureEditableRegions(html: string): string {
  const bodyStart = html.search(/<body[\s>]/i);
  if (bodyStart === -1) return html;
  const bodyOpenEnd = findTagEnd(html, bodyStart);
  if (bodyOpenEnd === -1) return html;

  // Spans already claimed: every existing data-region element, whole.
  const spans: Array<{ start: number; end: number }> = [];
  const regionNames = new Set<string>();
  const attrRe = /data-region="([^"]*)"/g;
  for (let m = attrRe.exec(html); m; m = attrRe.exec(html)) regionNames.add(m[1]);
  for (const name of regionNames) {
    for (let i = 0; ; i++) {
      const located = locateRegion(html, name, i);
      if (!located) break;
      spans.push({ start: located.start, end: located.end });
    }
  }
  // Comment spans (Outlook conditionals) are never candidates.
  for (let from = 0; ; ) {
    const open = html.indexOf("<!--", from);
    if (open === -1) break;
    const close = html.indexOf("-->", open);
    const end = close === -1 ? html.length : close + 3;
    spans.push({ start: open, end });
    from = end;
  }
  const claimed = (idx: number) => spans.some((s) => idx >= s.start && idx < s.end);

  const inserts: number[] = [];
  const candidateRe = /<([a-zA-Z][a-zA-Z0-9]*)/g;
  candidateRe.lastIndex = bodyOpenEnd;
  for (let m = candidateRe.exec(html); m; m = candidateRe.exec(html)) {
    const lt = m.index;
    if (!TEXT_BLOCK_TAGS.test(m[1]) || claimed(lt)) continue;

    const openEnd = findTagEnd(html, lt);
    if (openEnd === -1) continue;
    const openTag = html.slice(lt, openEnd);
    if (openTag.includes("data-region=")) continue;
    if (/display\s*:\s*none/i.test(openTag)) continue;

    const located = locateElementAt(html, lt);
    if (!located) continue;

    const text = located.innerHTML
      .replace(/<[^>]*>/g, " ")
      .replace(/&[a-zA-Z#0-9]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    // td/div wrappers with block children stay structural; their leaves get
    // tagged instead (this same loop reaches them later).
    if (/^(td|div)$/i.test(m[1]) && NESTED_BLOCK_RE.test(located.innerHTML)) continue;

    inserts.push(lt + 1 + m[1].length);
    // Everything inside this new region is claimed now.
    spans.push({ start: located.start, end: located.end });
  }

  let out = html;
  for (const at of inserts.sort((a, b) => b - a)) {
    out = `${out.slice(0, at)} data-region="body"${out.slice(at)}`;
  }
  return out;
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
 * Styles the header region, landing text-align where it actually moves the
 * logo. The code-template header is a `<table data-region="header">` whose
 * `<td>` holds the logo/wordmark; text-align must sit on that cell (and any
 * legacy align="" attribute there must go, or it wins in Outlook). Model
 * designs sometimes set the logo `<img>` to display:block, which text-align
 * can't move, so that is flipped to inline-block. Non-alignment props stay on
 * the wrapper like every other region.
 */
export function applyHeaderStyleChanges(elementHtml: string, changes: StyleChanges): string {
  const { textAlign, ...rest } = changes;
  let out = Object.keys(rest).length ? applyStyleChanges(elementHtml, rest) : elementHtml;
  if (!textAlign) return out;

  const tdIdx = out.search(/<td[\s>]/i);
  if (tdIdx === -1) {
    out = applyStyleChanges(out, { textAlign });
  } else {
    let cell = applyStyleChanges(out.slice(tdIdx), { textAlign });
    // Drop a legacy align attribute on that cell so it can't override the style.
    const cellOpen = /^<td\b[^>]*>/i.exec(cell)?.[0];
    if (cellOpen && /\salign="[^"]*"/i.test(cellOpen)) {
      cell = cellOpen.replace(/\salign="[^"]*"/i, "") + cell.slice(cellOpen.length);
    }
    out = out.slice(0, tdIdx) + cell;
  }

  // A block-level logo ignores text-align; make it flow inline instead.
  const imgMatch = /<img\b[^>]*>/i.exec(out);
  if (imgMatch && /display\s*:\s*block/i.test(imgMatch[0])) {
    const fixed = imgMatch[0].replace(/display\s*:\s*block/i, "display:inline-block");
    out = out.slice(0, imgMatch.index) + fixed + out.slice(imgMatch.index + imgMatch[0].length);
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

/**
 * Swaps the href on the CTA button (the <a> inside the data-region="cta"
 * wrapper every template and model-designed email tags) so editing the CTA
 * link field updates the rendered button, no model call needed.
 *
 * Scoped to the CTA region's own markup: locating the region first and
 * replacing only within its outerHTML means the replacement physically cannot
 * leave it, and an anchorless CTA (unusual, but model designs vary) leaves the
 * document alone instead of rewriting the first `<a href>` found elsewhere in
 * the document (in practice, the unsubscribe link).
 */
export function applyCtaHref(html: string, url: string): string {
  const href = url.trim() || "#";
  const located = locateRegion(html, "cta", 0);
  if (!located) return html;

  const anchorHref = /(<a\s[^>]*\bhref=")[^"]*(")/i;
  if (!anchorHref.test(located.outerHTML)) return html;

  const next = located.outerHTML.replace(anchorHref, `$1${href}$2`);
  return html.slice(0, located.start) + next + html.slice(located.end);
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
