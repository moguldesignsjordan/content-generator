// Placing the user's attached photos (brief.photo_urls) into email HTML.
// Deliberately NOT server-only, exactly like hero-image.ts: pure string
// transforms, no secrets, imported by vitest.
//
// The generation prompt asks the model to design every attached photo into
// the email itself; ensureBriefPhotos is the mechanical backstop (same
// pattern as ensureUnsubscribeTag / ensureBrandLogo) that splices in any
// photo the model skipped, so "I attached 3 photos" can never quietly
// produce an email with 2.

import { elementStart, elementEnd, esc, widenToRow } from "./hero-image";

/** Ceiling on how many attached photos one email carries; enforced where the
 * brief is written (chat mergeBrief) and again at the splice backstop. */
export const MAX_BRIEF_PHOTOS = 6;

function photoMarkup(url: string): string {
  return (
    `<img src="${esc(url)}" alt="" width="552" ` +
    `style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:12px;" />`
  );
}

/** A standalone photo block, for non-table (untagged/fallback) documents.
 * data-region="photo", never "image": that attribute is the hero's identity
 * and removeHeroImage would eat the first attached photo instead. */
function photoBlock(url: string): string {
  return `<div data-region="photo" style="margin:0 0 24px;">${photoMarkup(url)}</div>`;
}

/** The same block as its own table row, for table-based templates. */
function photoRow(url: string): string {
  return (
    `<tr><td data-region="photo" align="center" style="padding:0 48px 24px;">` +
    `${photoMarkup(url)}</td></tr>`
  );
}

/** Inserts one photo block right before the element carrying `attr`,
 * widening to the enclosing <tr> for table anchors. Null when absent. */
function insertPhotoBefore(html: string, attr: string, url: string): string | null {
  const start = elementStart(html, attr);
  if (start === -1) return null;
  const end = elementEnd(html, attr);
  const { start: at, isRow } = widenToRow(html, start, end === -1 ? start : end);
  const block = isRow ? photoRow(url) : photoBlock(url);
  return html.slice(0, at) + block + html.slice(at);
}

/** True when the document already shows this photo (as typed or attribute-
 * escaped), wherever the model chose to put it. */
function hasPhoto(html: string, url: string): boolean {
  return html.includes(url) || html.includes(esc(url));
}

/**
 * Guarantees every attached photo appears in the email. Photos the model
 * already placed are left exactly where it put them; missing ones are
 * spliced, in order, before the CTA (the natural "supporting imagery" slot),
 * falling back to just before </body>, then appending. Idempotent: running
 * it twice adds nothing.
 */
export function ensureBriefPhotos(html: string, urls: string[] | undefined): string {
  if (!urls?.length) return html;
  let out = html;
  for (const url of urls.slice(0, MAX_BRIEF_PHOTOS)) {
    if (!url || hasPhoto(out, url)) continue;
    const inserted =
      insertPhotoBefore(out, 'data-region="cta"', url) ??
      insertPhotoBefore(out, 'data-region="footer"', url);
    if (inserted) {
      out = inserted;
      continue;
    }
    if (/<\/body>/i.test(out)) {
      out = out.replace(/<\/body>/i, `${photoBlock(url)}</body>`);
    } else {
      out = out + photoBlock(url);
    }
  }
  return out;
}
