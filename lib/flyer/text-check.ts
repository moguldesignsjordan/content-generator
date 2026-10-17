// Pure text read-back comparison for AI-designed flyers. The image model
// typesets the copy itself when a flyer follows a look, so the rendered text
// is read back (lib/pipeline/read-image-text.ts) and checked here: every
// expected line must appear, the design mustn't repeat the examples' own
// words, and it mustn't carry a paragraph nobody asked for. Case and
// punctuation are ignored; the image model can't be expected to match a comma.

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9$%]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Adjacent word pairs. Pairs, not single words, so a common word the
 * examples happen to share with a new sample ("sign") never counts as copying,
 * while a business name or a phone number does. */
function pairs(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i < w.length - 1; i++) {
    if (w[i].length >= 4 || w[i + 1].length >= 4 || /\d/.test(w[i] + w[i + 1])) {
      out.add(`${w[i]} ${w[i + 1]}`);
    }
  }
  return out;
}

export interface TextCheckResult {
  ok: boolean;
  /** Expected lines that weren't found as written. */
  missing: string[];
  /** Distinct words in the image that aren't in any expected or allowed line. */
  extra: string[];
  /** Word pairs the design repeated from the examples' own text. */
  copied: string[];
}

/** `alsoAllowed` is text that may appear without being required: a client's
 * logo name, sample text on a showcased product, text already on the design.
 * `examplesText` is what the reference examples themselves say. */
export function checkRenderedText(
  expected: string[],
  seen: string,
  alsoAllowed: string[] = [],
  examplesText = "",
): TextCheckResult {
  const seenWords = words(seen);
  const seenJoined = ` ${seenWords.join(" ")} `;
  const lines = expected.map((l) => l.trim()).filter(Boolean);
  const missing = lines.filter((line) => !seenJoined.includes(` ${words(line).join(" ")} `));
  const allowed = new Set([...lines, ...alsoAllowed].flatMap(words));
  const extra = [...new Set(seenWords.filter((w) => !allowed.has(w)))];

  const ours = new Set([...lines, ...alsoAllowed].flatMap((l) => [...pairs(l)]));
  const fromExamples = pairs(examplesText);
  const copied = [...pairs(seen)].filter((p) => fromExamples.has(p) && !ours.has(p));

  // A handful of stray words is fine (a product's own label, sample text on a
  // mockup); a paragraph of them means the model wrote copy of its own. Words
  // count once: a label printed on every item of a mockup is still one label.
  const lineWords = new Set(lines.flatMap(words));
  const extraLimit = Math.max(8, Math.ceil(lineWords.size * 0.5));
  return {
    ok: missing.length === 0 && copied.length === 0 && extra.length <= extraLimit,
    missing,
    extra,
    copied,
  };
}
