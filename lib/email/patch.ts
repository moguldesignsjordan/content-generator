/**
 * Find/replace patching for model-authored HTML edits.
 *
 * A leaf module on purpose. Every pipeline that lets a model change an
 * existing document needs this one safety property, and putting it here means
 * a caller can get it without importing the whole generator (which drags in
 * the DB client, the image clients, and everything else along with it).
 */

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
