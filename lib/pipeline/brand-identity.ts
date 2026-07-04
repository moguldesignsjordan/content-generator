import "server-only";
import { FAST_MODEL, getAnthropic } from "@/lib/clients/anthropic";
import type { BrandColors, BrandFonts, Positioning, VoiceProfile } from "@/lib/db/types";
import type { ColorCandidate } from "@/lib/scrape/types";
import {
  BRAND_IDENTITY_TOOL,
  FONT_PAIRINGS,
  buildBrandIdentityMessages,
  type BrandIdentityToolInput,
} from "@/prompts/brand-identity";

// Shared by two callers: the standalone "Generate brand identity" action
// (Settings/onboarding, no site to ground it in) and the website importer's
// fallback (grounds it in whatever colors/fonts/context the scrape DID find,
// used when scraping succeeded but CSS extraction came up empty, e.g. sites
// that only use oklch() colors). One cheap Haiku call either way.

const HEX_RE = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Darkens a hex color in steps until white text on it clears the WCAG
 * AA-large threshold (3.0, appropriate for a big button label). The email
 * design system always pairs the accent with white CTA-button text, so this
 * is the one color that can't be left slightly off.
 */
function ensureAccentContrast(accent: string): string {
  let [r, g, b] = hexToRgb(accent);
  let hex = accent;
  for (let i = 0; i < 8 && contrast("#ffffff", hex) < 3.0; i++) {
    r *= 0.85;
    g *= 0.85;
    b *= 0.85;
    hex = rgbToHex(r, g, b);
  }
  return hex;
}

export interface GenerateBrandIdentityArgs {
  brandName: string;
  positioning?: Positioning;
  voiceProfile?: VoiceProfile;
  /** Grounds color choice in the real site when a scrape found some. */
  colorCandidates?: ColorCandidate[];
  fontCandidates?: string[];
  siteName?: string;
  metaDescription?: string;
}

export interface GeneratedBrandIdentity {
  colors: BrandColors;
  fonts: BrandFonts;
  reasoning: string;
}

/** Generates a palette + font pairing. Returns null on any model failure. */
export async function generateBrandIdentity(
  args: GenerateBrandIdentityArgs,
): Promise<GeneratedBrandIdentity | null> {
  const { system, user } = buildBrandIdentityMessages(args);

  const response = await getAnthropic().messages.create({
    model: FAST_MODEL,
    max_tokens: 512,
    system,
    messages: [{ role: "user", content: user }],
    tools: [BRAND_IDENTITY_TOOL],
    tool_choice: { type: "tool", name: "save_brand_identity" },
  });

  const tu = response.content.find(
    (b) => b.type === "tool_use" && b.name === "save_brand_identity",
  );
  if (!tu || tu.type !== "tool_use") return null;
  const raw = tu.input as BrandIdentityToolInput;

  const colors: BrandColors = {
    primary: raw.color_primary,
    secondary: raw.color_secondary,
    accent: raw.color_accent,
    background: raw.color_background,
    text: raw.color_text,
    muted: raw.color_muted,
  };
  for (const hex of Object.values(colors)) {
    if (!hex || !HEX_RE.test(hex)) return null;
  }

  // Safety net: a generated (or loosely site-grounded) palette has nothing
  // guaranteeing readability the way the website importer's hard-constrained
  // candidates do, so both pairings that matter get checked here.
  if (contrast(colors.text!, colors.background!) < 4.5) {
    const bgIsDark = luminance(colors.background!) < 0.5;
    colors.text = bgIsDark ? "#F8FAFC" : "#0F172A";
  }
  colors.accent = ensureAccentContrast(colors.accent!);

  const pairing =
    FONT_PAIRINGS.find((p) => p.key === raw.font_pairing_key) ?? FONT_PAIRINGS[1];

  return {
    colors,
    fonts: { heading: pairing.heading, body: pairing.body },
    reasoning: raw.reasoning,
  };
}
