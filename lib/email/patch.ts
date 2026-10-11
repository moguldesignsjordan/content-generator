/**
 * Find/replace patching for model-authored HTML edits.
 *
 * A leaf module on purpose. Every pipeline that lets a model change an
 * existing document needs this one safety property, and putting it here means
 * a caller can get it without importing the whole generator (which drags in
 * the DB client, the image clients, and everything else along with it).
 */

import type { EmailCopy } from "@/lib/db/types";

/** One find/replace patch a model returns. */
export interface HtmlPatch {
  find: string;
  replace: string;
  /** Set true only for a deliberate "change every instance" request. */
  replace_all?: boolean;
}

/**
 * Applies find/replace patches to html in order. Fails closed: each find must
 * appear at least once, and if it appears more than once without replace_all,
 * that's ambiguous (which occurrence was meant?) so it's rejected rather than
 * guessed. This is a real safety property: the model is mechanically unable
 * to touch anything outside the exact span it names.
 */
export function applyEdits(
  html: string,
  edits: HtmlPatch[],
): { html: string } | { error: string } {
  let patched = html;
  for (const edit of edits) {
    if (!edit.find) return { error: "An edit was missing its find text." };
    const occurrences = patched.split(edit.find).length - 1;
    if (occurrences === 0) {
      return {
        error: `Couldn't locate the exact text to change (starting "${edit.find.slice(0, 60)}"). Try rephrasing.`,
      };
    }
    if (occurrences > 1 && !edit.replace_all) {
      return {
        error: `That change matches ${occurrences} places ambiguously. Be more specific.`,
      };
    }
    patched = edit.replace_all
      ? patched.split(edit.find).join(edit.replace)
      : patched.replace(edit.find, edit.replace);
  }
  return { html: patched };
}

/**
 * Applies sentence-level patches to an email's structured copy AND its
 * rendered HTML together, so the two can't drift (a later redesign rebuilds
 * from the copy). Unlike applyEdits this skips, rather than fails on, a patch
 * it can't place exactly once in both: one sentence that didn't match
 * shouldn't throw away the fixes that did land.
 */
export function applyCopyPatches(
  copy: EmailCopy,
  html: string,
  edits: HtmlPatch[],
): { copy: EmailCopy; html: string; applied: HtmlPatch[] } {
  const next: EmailCopy = {
    ...copy,
    body_sections: copy.body_sections.map((s) => ({ ...s })),
  };
  let patched = html;
  const applied: HtmlPatch[] = [];
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  for (const edit of edits) {
    const { find, replace } = edit;
    // A replacement is plain copy; markup in it would inject into the email.
    if (!find || !replace || find === replace || /[<>]/.test(replace)) continue;

    const fields = copyFields(next).filter((f) => f.get().includes(find));
    if (fields.length !== 1 || count(fields[0].get(), find) !== 1) continue;
    const field = fields[0];

    // Templates escape copy into the HTML; model-designed HTML may not.
    const variants = [
      { find, replace },
      { find: escapeText(find), replace: escapeText(replace) },
    ];
    const hit = variants.find((v) => count(patched, v.find) === 1);
    // The subject line lives outside the body, so it may not be in the HTML.
    if (!hit && !(field.name === "subject" && variants.every((v) => count(patched, v.find) === 0))) {
      continue;
    }

    field.set(field.get().replace(find, replace));
    if (hit) patched = patched.replace(hit.find, hit.replace);
    applied.push(edit);
  }
  return { copy: next, html: patched, applied };
}

function copyFields(c: EmailCopy): { name: string; get: () => string; set: (v: string) => void }[] {
  return [
    { name: "subject", get: () => c.subject, set: (v) => (c.subject = v) },
    { name: "preheader", get: () => c.preheader, set: (v) => (c.preheader = v) },
    { name: "headline", get: () => c.headline, set: (v) => (c.headline = v) },
    { name: "cta_text", get: () => c.cta_text, set: (v) => (c.cta_text = v) },
    ...c.body_sections.flatMap((s) => [
      { name: "body", get: () => s.body, set: (v: string) => (s.body = v) },
      { name: "heading", get: () => s.heading ?? "", set: (v: string) => (s.heading = v) },
    ]),
  ];
}

/** Same escaping the email templates apply to copy (templates/shared.ts). */
function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
