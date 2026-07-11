import type { EmailStyleId } from "@/lib/db/types";

// A curated library of professional visual design directions. Each is a
// distinct "skin" (page background, card frame, header treatment, accent
// intensity, callout/divider style, CTA shape, radius, whitespace) that
// still leaves the model room to invent its own exact spacing/wording within
// the direction, rather than a rigid pixel spec. buildEmailDesignBrief (in
// email-design.ts) renders the chosen directive's lines into the "STYLE
// DIRECTION FOR THIS EMAIL" section; the EMAIL DESIGN SYSTEM invariants
// (dark-mode block, data-region anchors, one CTA, {$unsubscribe}, WCAG-AA
// contrast) apply identically underneath every style and are never repeated
// here, they're not this file's concern.

export interface EmailStyleDirective {
  id: EmailStyleId;
  label: string;
  lines: string[];
}

// Fixed order: the rotation (pickEmailStyle) cycles through this array, so
// its order only matters for how a series' distinct-by-index assignment
// looks (adjacent series items land on adjacent styles in this list).
export const EMAIL_STYLE_IDS: EmailStyleId[] = [
  "soft_card",
  "editorial_serif",
  "bold_accent_band",
  "minimal_mono",
  "bordered_ledger",
  "left_rule_editorial",
  "pill_modern",
  "warm_gradient_top",
];

export const EMAIL_STYLES: Record<EmailStyleId, EmailStyleDirective> = {
  soft_card: {
    id: "soft_card",
    label: "Soft card",
    lines: [
      "SOFT CARD: the safe, approachable baseline look.",
      "- Page background: a soft neutral tint (#EEF1F6 works well) behind the card.",
      "- Card: one centered card, 16px rounded corners, a thin 1px hairline border.",
      "- Header: logo or wordmark left-aligned, above a 1px hairline divider.",
      "- Eyebrow: a small uppercase kicker above the headline in the muted color, wide letter-spacing.",
      "- Accent bar: a 3px solid accent-colored top bar across the card gives it a quiet brand signature; this is the ONE accent moment besides the CTA.",
      "- Headline: 28 to 32px, bold, tight letter-spacing, primary color.",
      "- Callouts/dividers: callout boxes on a soft neutral-gray tint with a neutral hairline border; thin hairline dividers between sections.",
      "- CTA: a solid accent button, 10px rounded corners.",
      "- Whitespace: generous but standard, nothing cramped, nothing sparse.",
      "Clean and confident, not flashy; neutral surfaces carry the design.",
    ],
  },
  editorial_serif: {
    id: "editorial_serif",
    label: "Editorial serif",
    lines: [
      "EDITORIAL SERIF: a magazine feel, restrained and print-like.",
      "- Page background: pure white or a very light warm-gray (#F7F6F3).",
      "- Card: minimal or no visible border, generous side padding, square or barely-rounded corners (0 to 4px).",
      "- Header: centered wordmark or logo, small, above a thin hairline rule.",
      "- Eyebrow: a small letter-spaced caps label, understated, not heavily accent-colored.",
      "- Headline: large serif headline (32 to 36px), normal to medium weight (not heavy bold), tight leading.",
      "- Dividers/callouts: thin horizontal hairline rules between sections instead of boxed callouts; a highlighted line reads as a pull-quote (italic, thin left rule, no fill).",
      "- CTA: a text-forward button, low-key rectangle with sharp or barely-rounded corners (0 to 4px).",
      "- Accent: used sparingly, mostly on the eyebrow and one hairline rule.",
      "- Whitespace: airy, tall line-height, wide margins.",
      "Restrained and confident, never loud.",
    ],
  },
  bold_accent_band: {
    id: "bold_accent_band",
    label: "Bold accent band",
    lines: [
      "BOLD ACCENT BAND: a full accent header band, punchy and high-contrast.",
      "- Page background: neutral light gray.",
      "- Card: square or minimally rounded corners (0 to 4px), strong presence.",
      "- Header: sits INSIDE a full-width accent-colored band at the top of the card; a logo there is reversed out (white/light) on the band, otherwise use a bold reversed wordmark.",
      "- Eyebrow: a bold, reversed-out (white) uppercase label inside or just below the band.",
      "- Headline: large (32px+), heavy weight, high contrast, in the primary color, not the accent.",
      "- Callouts: boxes with a neutral dark-gray or hairline border, square corners; the band and CTA carry the color, callouts stay neutral.",
      "- CTA: a large, high-contrast rectangular button, sharp corners.",
      "- Accent: the header band and the CTA are the ONLY two accent moments; everything between them is black, white, and gray so the band reads as a deliberate statement, not a theme. The band's <td> MUST also carry a solid bgcolor attribute in the accent color (Outlook ignores CSS gradients/backgrounds on styled elements but honors the bgcolor attribute), so it still reads as a bold accent bar even there.",
      "- Whitespace: confident and punchy, less airy than editorial but never cramped.",
    ],
  },
  minimal_mono: {
    id: "minimal_mono",
    label: "Minimal mono",
    lines: [
      "MINIMAL MONO: borderless, very airy, understated.",
      "- Page background: near-white (#FAFAFA or white).",
      "- Card: borderless, no visible card edge, generous padding on a plain background; if any separation is needed use a single near-invisible 1px hairline.",
      "- Header: small, left-aligned, understated wordmark, no divider beneath it.",
      "- Eyebrow: a tiny uppercase label in muted gray (not accent-colored), wide letter-spacing.",
      "- Headline: medium weight (not heavy bold), 26 to 28px, restrained.",
      "- Dividers/callouts: no boxed callouts; separate sections purely with whitespace and a small label, not borders or fills.",
      "- CTA: one solid button, minimal radius (6px); keep it a clear, real clickable element even in this pared-back style.",
      "- Accent: used ONLY on the CTA button, nowhere else.",
      "- Whitespace: maximum, the airiest of all the styles.",
    ],
  },
  bordered_ledger: {
    id: "bordered_ledger",
    label: "Bordered ledger",
    lines: [
      "BORDERED LEDGER: structured and enterprise, like a well-organized document.",
      "- Page background: light neutral gray.",
      "- Card: a full 1px border on all four sides, sharp or barely-rounded corners (0 to 4px).",
      "- Header: logo/wordmark left-aligned; a small letter-spaced meta label (e.g. a date or category tag) right-aligned on the same row if space allows.",
      "- Eyebrow: a small letter-spaced label set inside a thin-bordered tag/chip.",
      "- Headline: medium-large (26 to 30px), semi-bold, no italics.",
      "- Dividers/callouts: sections separated by full-width 1px hairlines like ledger rows; any callout gets its own fully-bordered box with sharp corners.",
      "- CTA: a bordered or solid button with sharp to minimal corners (0 to 4px), slightly wider letter-spacing on the label.",
      "- Accent: the CTA plus at most one small detail (e.g. the eyebrow chip's border); structural borders and hairlines stay neutral gray.",
      "- Whitespace: even and structured, not airy, like a well-organized form.",
    ],
  },
  left_rule_editorial: {
    id: "left_rule_editorial",
    label: "Left rule editorial",
    lines: [
      "LEFT RULE EDITORIAL: a thick accent rule carries the brand weight.",
      "- Page background: soft neutral tint.",
      "- Card: rounded corners (12px), with a thick (6 to 8px) solid accent-colored rule running down the full left edge of the card's inner content column.",
      "- Header: logo/wordmark indented to align with the body content, inset from the left rule.",
      "- Eyebrow: an uppercase label in the muted color, indented to match.",
      "- Headline: large (30 to 34px), bold.",
      "- Dividers/callouts: sections stay indented consistently from the left rule; callouts are plain (no extra box), the rule itself carries the accent weight.",
      "- CTA: a solid rounded button (10px radius), indented with the rest of the content.",
      "- Accent: concentrated almost entirely in the left rule, used lightly elsewhere.",
      "- Whitespace: generous vertical rhythm between sections.",
    ],
  },
  pill_modern: {
    id: "pill_modern",
    label: "Pill modern",
    lines: [
      "PILL MODERN: rounded, friendly, SaaS-product feel.",
      "- Page background: light neutral, or a very soft accent-tinted white.",
      "- Card: large rounded corners (20 to 24px), soft and friendly.",
      "- Header: centered logo/wordmark, no divider beneath it, extra top padding.",
      "- Eyebrow: a small rounded PILL/chip badge (very light accent-tinted background, accent text, fully rounded corners) instead of a plain uppercase label.",
      "- Headline: bold, 28 to 32px, rounded/friendly type feel, primary color.",
      "- Callouts: soft rounded-corner boxes (16px radius) on a light NEUTRAL gray tint, no hard borders; the pill badge and CTA are the only accented elements.",
      "- CTA: a LARGE fully-rounded pill-shaped button (very high border-radius, e.g. 999px), the visual centerpiece of the email.",
      "- Accent: only the eyebrow pill and the CTA; everything else neutral and soft.",
      "- Whitespace: generous, rounded, comfortable.",
    ],
  },
  warm_gradient_top: {
    id: "warm_gradient_top",
    label: "Warm gradient top",
    lines: [
      "WARM GRADIENT TOP: a subtle two-stop accent gradient band, friendly.",
      "- Page background: soft neutral tint.",
      "- Card: rounded corners (14px).",
      "- Accent band: a subtle 2-stop gradient top bar (the accent color into a lighter or warmer tint of it), spanning the full card width, taller than a standard top bar (10 to 14px). Its <td> MUST also carry a solid bgcolor attribute set to the plain accent color as a fallback (Outlook does not render CSS gradients), so the bar still reads as an intentional accent stripe there.",
      "- Header: logo/wordmark sits just below the gradient band.",
      "- Eyebrow: an uppercase label in the muted color just below the band.",
      "- Headline: bold, 28 to 32px, primary color.",
      "- Callouts: callout boxes on a barely-there warm neutral tint (nearly white), rounded corners, no accent borders.",
      "- CTA: a solid accent button, 10px rounded corners; may pick up the gradient's warmer end as a highlight, but stays a single solid color for full client compatibility.",
      "- Accent: ONLY the top band and the CTA; the body of the email stays warm-neutral so the band feels like a signature, not a theme.",
      "- Whitespace: generous, friendly.",
    ],
  },
};

/**
 * Generic no-consecutive-repeat rotation picker shared by style and layout
 * selection. Two modes:
 *  - `seedIndex` given (campaign series): deterministic, distinct-by-index
 *    across a batch (cycles through `ids` in order), no DB read needed so
 *    parallel per-draft generation calls can't race each other.
 *  - otherwise: excludes the last `avoidLastK` recently-used ids (most
 *    recent first) and picks randomly from what's left, so a single stream
 *    of generations never repeats within that window.
 */
export function pickRotation<T>(
  ids: readonly T[],
  opts: { recent?: T[]; seedIndex?: number; avoidLastK?: number } = {},
): T {
  if (ids.length === 0) {
    throw new Error("pickRotation: ids must be non-empty");
  }
  if (opts.seedIndex !== undefined) {
    const i = ((opts.seedIndex % ids.length) + ids.length) % ids.length;
    return ids[i];
  }
  if (ids.length === 1) return ids[0];

  const recent = opts.recent ?? [];
  const k = Math.min(opts.avoidLastK ?? ids.length - 1, ids.length - 1);
  const excluded = new Set(recent.slice(0, k));
  const pool = ids.filter((id) => !excluded.has(id));
  // If excluding the whole window emptied the pool (small candidate sets),
  // relax to "not the single most recent one" so a pick is always possible.
  const finalPool = pool.length > 0 ? pool : ids.filter((id) => id !== recent[0]);
  const usable = finalPool.length > 0 ? finalPool : [...ids];
  return usable[Math.floor(Math.random() * usable.length)];
}

/**
 * Picks the visual style for a fresh email generation. Never repeats any of
 * the last 3 styles used (across all 8, that's always satisfiable) unless
 * `seedIndex` is given, in which case it's the deterministic series
 * assignment (see pickRotation).
 */
export function pickEmailStyle(
  opts: { recent?: EmailStyleId[]; seedIndex?: number } = {},
): EmailStyleId {
  return pickRotation(EMAIL_STYLE_IDS, { ...opts, avoidLastK: 3 });
}
