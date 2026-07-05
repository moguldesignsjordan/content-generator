import "server-only";

// WCAG relative luminance + contrast ratio, shared by anything that needs to
// verify or choose readable color pairs (brand-identity generation, the
// brand-book document's swatch labels). Single source of truth so this math
// isn't reimplemented per caller.

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Picks near-black or near-white, whichever reads better on the given background. */
export function readableTextColor(bgHex: string): string {
  if (!HEX_RE.test(bgHex)) return "#0F172A";
  return contrast("#0B0B0F", bgHex) >= contrast("#FAFAFA", bgHex) ? "#0B0B0F" : "#FAFAFA";
}
