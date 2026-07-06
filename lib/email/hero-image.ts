// Splicing the hero image into email HTML. Deliberately NOT server-only:
// pure string transforms, no secrets, imported by vitest (the type-only
// import below is erased at runtime).
//
// Region anchors sit on <td> cells inside real templates (each region is its
// own <tr><td data-region="...">...</td></tr> row) — a bare <div> spliced in
// as a stray child of <tr> is invalid table markup, and browsers/email
// clients "foster parent" it out of the table entirely (silently relocating
// it to just before the table, regardless of the intended anchor). So the
// hero block is wrapped as its own row whenever the anchor is a <td>; the
// bare <div> form is kept only as a fallback for untagged/non-table
// documents. The <img> follows email best practice: explicit dimensions,
// display:block, max-width:100%, meaningful alt, never a CSS background-image.

import type { ContentImage } from "@/lib/db/types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function imageMarkup(img: ContentImage): string {
  return (
    `<img src="${esc(img.url)}" alt="${esc(img.alt)}" width="552" ` +
    `style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:12px;" />`
  );
}

/** A standalone hero block, for non-table (untagged/fallback) documents. */
export function renderHeroImageBlock(img: ContentImage): string {
  return `<div data-region="image" style="margin:0 0 28px;">${imageMarkup(img)}</div>`;
}

/** The same block as its own table row, for table-based templates. */
function renderHeroImageRow(img: ContentImage): string {
  return (
    `<tr><td data-region="image" align="center" style="padding:0 48px 28px;">` +
    `${imageMarkup(img)}</td></tr>`
  );
}

/** Index of the '<' opening the first element carrying `attr`, or -1. */
function elementStart(html: string, attr: string): number {
  const attrIdx = html.indexOf(attr);
  if (attrIdx === -1) return -1;
  return html.lastIndexOf("<", attrIdx);
}

function tagNameAt(html: string, start: number): string | null {
  return /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(start))?.[1]?.toLowerCase() ?? null;
}

/**
 * Index just past the closing tag of the first element carrying `attr`, or
 * -1. Assumes the element doesn't nest its own tag name (true for the h1/td
 * elements regions are put on; a wrong guess degrades to a placement
 * fallback, never a corrupt document).
 */
function elementEnd(html: string, attr: string): number {
  const start = elementStart(html, attr);
  if (start === -1) return -1;
  const tag = tagNameAt(html, start);
  if (!tag) return -1;
  const close = html.toLowerCase().indexOf(`</${tag}>`, start);
  return close === -1 ? -1 : close + tag.length + 3;
}

/**
 * When `start`/`end` bound a <td> region cell, widens the range to its
 * enclosing <tr>...</tr> so a hero row can be inserted/removed as a whole
 * sibling row. Returns the original bounds (and isRow: false) for anchors
 * that aren't table cells, e.g. untagged fallback <h1>/<div> documents.
 */
function widenToRow(
  html: string,
  start: number,
  end: number,
): { start: number; end: number; isRow: boolean } {
  if (tagNameAt(html, start) !== "td") return { start, end, isRow: false };
  const trStart = html.toLowerCase().lastIndexOf("<tr", start);
  const trEnd = html.toLowerCase().indexOf("</tr>", end);
  if (trStart === -1 || trEnd === -1) return { start, end, isRow: false };
  return { start: trStart, end: trEnd + 5, isRow: true };
}

function insertBeforeAnchor(html: string, attr: string, img: ContentImage): string | null {
  const start = elementStart(html, attr);
  if (start === -1) return null;
  const end = elementEnd(html, attr);
  const { start: at, isRow } = widenToRow(html, start, end === -1 ? start : end);
  const block = isRow ? renderHeroImageRow(img) : renderHeroImageBlock(img);
  return html.slice(0, at) + block + html.slice(at);
}

function insertAfterAnchor(html: string, attr: string, img: ContentImage): string | null {
  const start = elementStart(html, attr);
  if (start === -1) return null;
  const end = elementEnd(html, attr);
  if (end === -1) return null;
  const { end: at, isRow } = widenToRow(html, start, end);
  const block = isRow ? renderHeroImageRow(img) : renderHeroImageBlock(img);
  return html.slice(0, at) + block + html.slice(at);
}

/**
 * Places (or re-places) the hero image block in a draft's HTML at the
 * image's placement (default "top"). Any existing hero block is removed
 * first, so one function covers insert, replace, and move. Each placement
 * falls back down the anchor chain when its own anchor is missing; returns
 * null only when the document has no usable anchor at all.
 */
export function spliceHeroImage(html: string, img: ContentImage): string | null {
  const base = removeHeroImage(html);
  const placement = img.placement ?? "top";

  if (placement === "above_cta") {
    const out = insertBeforeAnchor(base, 'data-region="cta"', img);
    if (out) return out;
  }

  if (placement === "above_cta" || placement === "below_headline") {
    const out = insertAfterAnchor(base, 'data-region="headline"', img);
    if (out) return out;
    // Untagged documents: fall back to the first <h1>.
    const h1 = base.search(/<h1[\s>]/i);
    if (h1 !== -1) {
      const close = base.toLowerCase().indexOf("</h1>", h1);
      if (close !== -1) {
        const after = close + 5;
        return base.slice(0, after) + renderHeroImageBlock(img) + base.slice(after);
      }
    }
  }

  // "top", and the final fallback for every other placement: before the
  // headline → before the first body region → before the first <h1>.
  for (const anchor of ['data-region="headline"', 'data-region="body"']) {
    const out = insertBeforeAnchor(base, anchor, img);
    if (out) return out;
  }
  const h1 = base.search(/<h1[\s>]/i);
  if (h1 !== -1) {
    return base.slice(0, h1) + renderHeroImageBlock(img) + base.slice(h1);
  }
  return null;
}

/**
 * Removes the hero image block, whether it's a bare <div> (untagged
 * documents) or a full <tr><td> row (table-based templates) — the entire
 * row comes out, never a dangling empty <tr></tr>. No-op without one.
 */
export function removeHeroImage(html: string): string {
  const attr = 'data-region="image"';
  const start = elementStart(html, attr);
  if (start === -1) return html;
  const end = elementEnd(html, attr);
  if (end === -1) return html;
  const { start: at, end: to } = widenToRow(html, start, end);
  return html.slice(0, at) + html.slice(to);
}
