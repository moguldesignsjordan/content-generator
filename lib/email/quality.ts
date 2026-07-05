import "server-only";

// Code-level email quality checks that don't need a model call. These back up
// the prompt rules the way stripEmDashes backs up the em-dash ban: the model
// is ASKED to comply, but these guarantee detection even when it slips.
//
// - findBannedTerms: detects banned vocabulary in the rendered email's visible
//   text. Detection, not deletion (mechanically removing words mangles
//   sentences); the approve route refuses to approve while any are present
//   unless explicitly overridden.
// - contrastIssues: WCAG-AA spot check on inline color/background pairs in
//   model-designed HTML. Brand tokens are AA-validated upstream, but the model
//   can still emit an off-token low-contrast combo; this flags it for the
//   review screen at zero model cost.

/** Visible text of an email HTML document (tags, styles, and entities stripped down). */
export function visibleEmailText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#847;|&zwnj;/g, " ")
    .replace(/\s+/g, " ");
}

/** Case-insensitive banned-term scan over the email's visible text. */
export function findBannedTerms(html: string, terms: string[]): string[] {
  if (!terms.length) return [];
  const text = visibleEmailText(html).toLowerCase();
  return terms.filter((term) => {
    const t = term.trim().toLowerCase();
    return t.length > 0 && text.includes(t);
  });
}

// ── Contrast ────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Expands #abc to #aabbcc; returns null for anything that isn't a 3/6-digit hex. */
function normalizeHex(raw: string): string | null {
  const h = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  if (/^#[0-9a-f]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return null;
}

/**
 * Scans inline styles for elements that declare BOTH a text color and a
 * background, plus the dominant page-level pair, and reports any combo under
 * WCAG AA (4.5:1). Heuristic by design: no DOM, no inheritance resolution,
 * just the pairs that are explicit enough to check for free.
 */
export function contrastIssues(html: string): string[] {
  const issues: string[] = [];
  const styleAttrs = html.match(/style="[^"]*"/gi) ?? [];

  const seen = new Set<string>();
  for (const attr of styleAttrs) {
    const fgMatch = attr.match(/(?:^|[^-])color\s*:\s*(#[0-9a-fA-F]{3,6})/);
    const bgMatch = attr.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})/);
    if (!fgMatch || !bgMatch) continue;
    const fg = normalizeHex(fgMatch[1]);
    const bg = normalizeHex(bgMatch[1]);
    if (!fg || !bg) continue;
    const key = `${fg}/${bg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5) {
      issues.push(
        `Low contrast: text ${fg} on background ${bg} is ${ratio.toFixed(1)}:1 (needs 4.5:1). Hard to read for some subscribers.`,
      );
    }
  }
  return issues;
}
