import type { FlyerLayout } from "@/lib/db/types";
import type { FlyerQuietZone } from "@/prompts/generate-flyer";

export type { FlyerLayout };

// Pure layout math for composed flyers: which of the four templates a variant
// uses, where its art sits, how big the headline is, and which font family a
// brand's CSS font stack names. No rendering here, so it's unit-tested
// directly; lib/flyer/compose.tsx draws from it.

/** Rotation order: each of a flyer's four options gets a different layout. */
export const FLYER_LAYOUTS: FlyerLayout[] = ["band_bottom", "gradient", "card", "band_top"];

export function pickLayout(index: number): FlyerLayout {
  return FLYER_LAYOUTS[((index % FLYER_LAYOUTS.length) + FLYER_LAYOUTS.length) % FLYER_LAYOUTS.length];
}

/** The part of the frame the art should keep calm for this layout's text. */
export function quietZoneFor(layout: FlyerLayout): FlyerQuietZone {
  // Band layouts put the art in its own region; text never covers it.
  return layout === "gradient" || layout === "card" ? "bottom" : "none";
}

/** Fraction of the canvas height the art fills (the band takes the rest).
 * A square canvas gives its band more room, since a headline and a
 * supporting line need about the same height whatever the frame. */
export function artHeightFraction(layout: FlyerLayout, width = 1080, height = 1350): number {
  const square = height / width < 1.1;
  if (layout === "band_bottom") return square ? 0.5 : 0.6;
  if (layout === "band_top") return square ? 0.5 : 0.62;
  return 1;
}

/** Headline size in px for a canvas `width` px wide: shorter lines run bigger. */
export function headlineSize(headline: string, width: number): number {
  const chars = headline.trim().length;
  const k = chars <= 16 ? 0.105 : chars <= 28 ? 0.085 : chars <= 45 ? 0.07 : 0.058;
  return Math.round(width * k);
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "-apple-system",
  "blinkmacsystemfont",
  "inherit",
]);

/** The first real family in a CSS font stack ("'Sora', sans-serif" gives
 * "Sora"), or null when it only names generic families. */
export function primaryFontFamily(stack: string | undefined | null): string | null {
  for (const raw of (stack ?? "").split(",")) {
    const name = raw.trim().replace(/^['"]|['"]$/g, "").trim();
    if (name && !GENERIC_FAMILIES.has(name.toLowerCase()) && !name.startsWith("var(")) {
      return name;
    }
  }
  return null;
}
