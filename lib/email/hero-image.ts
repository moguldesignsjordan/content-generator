// Splicing the hero image into email HTML. Deliberately NOT server-only:
// pure string transforms, no secrets, imported by vitest (the type-only
// import below is erased at runtime).
//
// The hero block is a single flat <div data-region="image"> with no nested
// divs, so it can be found and replaced with a non-greedy regex safely. The
// <img> follows email best practice: explicit dimensions, display:block,
// max-width:100%, meaningful alt, never a CSS background-image.

import type { ContentImage } from "@/lib/db/types";

const HERO_BLOCK_RE = /<div data-region="image"[\s\S]*?<\/div>/;

export function renderHeroImageBlock(img: ContentImage): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return (
    `<div data-region="image" style="margin:0 0 28px;">` +
    `<img src="${esc(img.url)}" alt="${esc(img.alt)}" width="552" ` +
    `style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:12px;" />` +
    `</div>`
  );
}

/** Index of the '<' opening the first element carrying `attr`, or -1. */
function elementStart(html: string, attr: string): number {
  const attrIdx = html.indexOf(attr);
  if (attrIdx === -1) return -1;
  return html.lastIndexOf("<", attrIdx);
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
  const tag = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(start))?.[1];
  if (!tag) return -1;
  const close = html.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, start);
  return close === -1 ? -1 : close + tag.length + 3;
}

/**
 * Places (or re-places) the hero image block in a draft's HTML at the
 * image's placement (default "top"). Any existing hero block is removed
 * first, so one function covers insert, replace, and move. Each placement
 * falls back down the anchor chain when its own anchor is missing; returns
 * null only when the document has no usable anchor at all.
 */
export function spliceHeroImage(html: string, img: ContentImage): string | null {
  const block = renderHeroImageBlock(img);
  const base = removeHeroImage(html);
  const placement = img.placement ?? "top";

  if (placement === "above_cta") {
    const at = elementStart(base, 'data-region="cta"');
    if (at !== -1) return base.slice(0, at) + block + base.slice(at);
  }

  if (placement === "above_cta" || placement === "below_headline") {
    let after = elementEnd(base, 'data-region="headline"');
    if (after === -1) {
      // Untagged documents: fall back to the first <h1>.
      const h1 = base.search(/<h1[\s>]/i);
      if (h1 !== -1) {
        const close = base.toLowerCase().indexOf("</h1>", h1);
        if (close !== -1) after = close + 5;
      }
    }
    if (after !== -1) return base.slice(0, after) + block + base.slice(after);
  }

  // "top", and the final fallback for every other placement: before the
  // headline → before the first body region → before the first <h1>.
  for (const anchor of ['data-region="headline"', 'data-region="body"']) {
    const tagStart = elementStart(base, anchor);
    if (tagStart === -1) continue;
    return base.slice(0, tagStart) + block + base.slice(tagStart);
  }
  const h1 = base.search(/<h1[\s>]/i);
  if (h1 !== -1) {
    return base.slice(0, h1) + block + base.slice(h1);
  }
  return null;
}

/** Removes the hero image block. Returns the html unchanged if none exists. */
export function removeHeroImage(html: string): string {
  return html.replace(HERO_BLOCK_RE, "");
}
