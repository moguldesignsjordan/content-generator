import type { BrandColors, DesignLookProfile } from "@/lib/db/types";
import { contrast, luminance, readableTextColor } from "@/lib/color/contrast";

// Brand colors, used the way the look uses color instead of one fixed recipe
// (before: primary was always a big flat band, accent always the button). A
// look whose examples sit on a dark field gets the brand's darkest color
// there; a vivid look gets the brand's boldest; the accent stays the one pop.

const HEX = /^#[0-9a-f]{6}$/i;

export interface ColorRoles {
  background: string;
  text: string;
  accent: string;
}

function saturation(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

export function mapBrandColors(
  colors: BrandColors,
  background: DesignLookProfile["color_roles"]["background"],
): ColorRoles {
  const palette = [...new Set(
    [colors.primary, colors.secondary, colors.accent, colors.background, colors.text, colors.muted]
      .filter((c): c is string => typeof c === "string" && HEX.test(c))
      .map((c) => c.toUpperCase()),
  )];
  const byLum = [...palette].sort((a, b) => luminance(a) - luminance(b));
  const darkest = byLum[0];
  const lightest = byLum[byLum.length - 1];
  const boldest = [...palette].sort((a, b) => saturation(b) - saturation(a))[0];

  // Fall back to a neutral when the brand has nothing that fits the role, so
  // a pale-only palette never becomes a "dark" background.
  let bg: string;
  if (background === "dark") bg = darkest && luminance(darkest) < 0.12 ? darkest : "#111114";
  else if (background === "light") bg = lightest && luminance(lightest) > 0.75 ? lightest : "#FAFAF7";
  else if (background === "vivid") bg = boldest && saturation(boldest) > 0.45 ? boldest : colors.primary && HEX.test(colors.primary) ? colors.primary.toUpperCase() : "#111114";
  else bg = darkest && luminance(darkest) < 0.12 ? darkest : "#111114"; // photo: panels and scrims behind text

  const brandText = colors.text && HEX.test(colors.text) ? colors.text.toUpperCase() : null;
  const text = brandText && contrast(brandText, bg) >= 4.5 ? brandText : readableTextColor(bg);

  // The accent must stand apart from the background; otherwise use the next
  // boldest brand color that does, then the text color. 1.5:1 on luminance
  // alone: a saturated hue pops on a pale field (orange on white) even at
  // modest luminance contrast, so the bar only rules out colors that blend in.
  const candidates = [
    colors.accent && HEX.test(colors.accent) ? colors.accent.toUpperCase() : null,
    ...[...palette].sort((a, b) => saturation(b) - saturation(a)),
  ].filter((c): c is string => Boolean(c) && c !== bg);
  const accent = candidates.find((c) => contrast(c, bg) >= 1.5) ?? text;

  return { background: bg, text, accent };
}
