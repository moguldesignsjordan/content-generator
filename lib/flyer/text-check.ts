// Pure text read-back comparison for AI-designed flyers. The image model
// typesets the copy itself when a flyer follows a look, so the rendered text
// is read back (lib/pipeline/read-image-text.ts) and checked here: every
// expected line must appear, and the image mustn't carry much text nobody
// asked for (example ads' words leaking in). Case and punctuation are ignored;
// the image model can't be expected to match a comma.

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9$%]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export interface TextCheckResult {
  ok: boolean;
  /** Expected lines that weren't found as written. */
  missing: string[];
  /** Words in the image that aren't in any expected line. */
  extra: string[];
}

/** `alsoAllowed` is text that may appear without being required, like the
 * name inside a client's logo the model draws. */
export function checkRenderedText(expected: string[], seen: string, alsoAllowed: string[] = []): TextCheckResult {
  const seenWords = words(seen);
  const seenJoined = ` ${seenWords.join(" ")} `;
  const lines = expected.map((l) => l.trim()).filter(Boolean);
  const missing = lines.filter((line) => !seenJoined.includes(` ${words(line).join(" ")} `));
  const allowed = new Set(lines.flatMap(words));
  const logoWords = new Set(alsoAllowed.flatMap(words));
  const extra = seenWords.filter((w) => !allowed.has(w) && !logoWords.has(w));
  // A few stray words are fine (a product's own printed label); a paragraph
  // of them means the model copied text from somewhere.
  const extraLimit = Math.max(4, Math.ceil(allowed.size * 0.3));
  return { ok: missing.length === 0 && extra.length <= extraLimit, missing, extra };
}
