import type { Anthropic } from "@anthropic-ai/sdk";
import type { Positioning, VoiceProfile } from "@/lib/db/types";
import type { ColorCandidate } from "@/lib/scrape/types";

// Visual identity generation: one cheap, non-thinking call (FAST_MODEL)
// picks a color palette and a font pairing so email generation has real
// brand tokens instead of generic defaults. Two modes, same prompt:
// - From scratch (no website): colors are genuinely invented (nothing to
//   ground them in, so nothing to hallucinate against).
// - Grounded (a website WAS scraped but its CSS yielded few/no usable
//   colors, e.g. oklch()-only sites): the site's own color/font candidates
//   and business context are passed in and preferred over invention.
// Fonts are always constrained to a curated list of email-safe stacks so
// nothing unavailable or broken ships. A logo image is out of scope, the
// email design system already renders a styled text wordmark when
// visual_identity.logo_url is empty.

export const FONT_PAIRINGS: {
  key: string;
  heading: string;
  body: string;
  vibe: string;
}[] = [
  {
    key: "modern-geometric",
    heading: "Poppins, Helvetica Neue, Arial, sans-serif",
    body: "Inter, system-ui, sans-serif",
    vibe: "Modern, confident, a little bold. Startups, tech, agencies.",
  },
  {
    key: "clean-humanist",
    heading: "Inter, system-ui, sans-serif",
    body: "Inter, system-ui, sans-serif",
    vibe: "Understated, professional, easy to trust. SaaS, consulting, finance.",
  },
  {
    key: "editorial-serif",
    heading: "Georgia, 'Times New Roman', serif",
    body: "Inter, system-ui, sans-serif",
    vibe: "Editorial, thoughtful, a little literary. Media, publishing, coaching.",
  },
  {
    key: "classic-serif",
    heading: "'Playfair Display', Georgia, serif",
    body: "Georgia, 'Times New Roman', serif",
    vibe: "Elegant, established, upscale. Luxury, hospitality, design studios.",
  },
  {
    key: "friendly-rounded",
    heading: "'Quicksand', Verdana, sans-serif",
    body: "'Trebuchet MS', Verdana, sans-serif",
    vibe: "Warm, approachable, playful. Wellness, community, consumer brands.",
  },
  {
    key: "sharp-technical",
    heading: "'Helvetica Neue', Arial, sans-serif",
    body: "Arial, Helvetica, sans-serif",
    vibe: "Precise, no-nonsense, engineering-minded. Dev tools, infrastructure.",
  },
];

export interface BrandIdentityToolInput {
  color_primary: string;
  color_secondary: string;
  color_accent: string;
  color_background: string;
  color_text: string;
  color_muted: string;
  font_pairing_key: string;
  reasoning: string;
}

export const BRAND_IDENTITY_TOOL: Anthropic.Tool = {
  name: "save_brand_identity",
  description:
    "Return a cohesive visual identity: a color palette and a font pairing " +
    "choice, grounded in the brand's actual description and voice.",
  input_schema: {
    type: "object",
    properties: {
      color_primary: {
        type: "string",
        description: "Main brand color for headlines/wordmark, hex e.g. #1A2B3C.",
      },
      color_secondary: {
        type: "string",
        description: "Supporting color, hex.",
      },
      color_accent: {
        type: "string",
        description:
          "CTA button / highlight color, hex. Renders as a button with WHITE text on it, so it must be dark or saturated enough for white text to read clearly, avoid light or pastel accents.",
      },
      color_background: {
        type: "string",
        description: "Card/page background, hex. Usually near-white or a deep tone for a bold look.",
      },
      color_text: {
        type: "string",
        description: "Body text color, hex. Must read comfortably on color_background (WCAG AA or better).",
      },
      color_muted: {
        type: "string",
        description: "Footer/meta text color, hex. Lower contrast than color_text but still legible.",
      },
      font_pairing_key: {
        type: "string",
        description: "The key of the ONE font pairing from FONT PAIRINGS that best fits this brand.",
      },
      reasoning: {
        type: "string",
        description: "One sentence on why this palette and pairing fit the brand.",
      },
    },
    required: [
      "color_primary",
      "color_secondary",
      "color_accent",
      "color_background",
      "color_text",
      "color_muted",
      "font_pairing_key",
      "reasoning",
    ],
  },
};

/** Builds the (system, user) pair for one identity-generation call. */
export function buildBrandIdentityMessages(args: {
  brandName: string;
  positioning?: Positioning;
  voiceProfile?: VoiceProfile;
  colorCandidates?: ColorCandidate[];
  fontCandidates?: string[];
  siteName?: string;
  metaDescription?: string;
}): { system: string; user: string } {
  const {
    brandName,
    positioning = {},
    voiceProfile = {},
    colorCandidates,
    fontCandidates,
    siteName,
    metaDescription,
  } = args;

  const pairingLines = FONT_PAIRINGS.map(
    (p) => `  - ${p.key}: heading "${p.heading}", body "${p.body}". ${p.vibe}`,
  );

  const grounded = !!(colorCandidates?.length || fontCandidates?.length);

  const system = [
    "You are a brand designer. Given a business's name, description, and",
    "voice, you choose a color palette and a font pairing that would look",
    "genuinely good in a real marketing email, not generic AI defaults.",
    "",
    "RULES:",
    "- Palette must be cohesive and on-brand, not random. Pick a mood",
    "  (bold, calm, playful, premium, technical) and commit to it.",
    grounded
      ? "- A scan of the brand's actual website is provided below (SITE COLORS /" +
        "  SITE FONTS). PREFER these real colors and fonts for whichever roles" +
        "  they plausibly fill; invent complementary colors only for roles" +
        "  none of them fit. This should look like their site, not a random one."
      : "",
    "- color_text on color_background, and white text on color_accent, must",
    "  both be comfortably readable (WCAG AA contrast or better).",
    "- font_pairing_key MUST be one of the FONT PAIRINGS keys below, chosen",
    "  for genuine fit" +
      (grounded ? " (factor in SITE FONTS if given)" : "") +
      ", not the first one.",
    "- Return hex colors only, 6-digit, like #1A2B3C.",
    "- Call save_brand_identity once with everything filled.",
  ]
    .filter(Boolean)
    .join("\n");

  const colorLines = colorCandidates?.length
    ? colorCandidates
        .slice(0, 15)
        .map((c) => `  ${c.hex} (seen ${c.count}x${c.source === "css-var" ? ", css variable: strong signal" : ""})`)
    : [];
  const fontLines = fontCandidates?.length ? fontCandidates.map((f) => `  ${f}`) : [];

  const user = [
    `BRAND: ${brandName}`,
    siteName && siteName !== brandName ? `SITE NAME: ${siteName}` : "",
    metaDescription ? `SITE DESCRIPTION: ${metaDescription}` : "",
    positioning.business_description
      ? `WHAT THEY DO: ${positioning.business_description}`
      : "",
    positioning.tagline ? `TAGLINE: ${positioning.tagline}` : "",
    positioning.differentiators?.length
      ? `DIFFERENTIATORS: ${positioning.differentiators.join("; ")}`
      : "",
    voiceProfile.voice ? `VOICE: ${voiceProfile.voice}` : "",
    voiceProfile.tone ? `TONE: ${voiceProfile.tone}` : "",
    !positioning.business_description && !voiceProfile.voice && !metaDescription
      ? "(No further brand info yet, work from the name alone and keep the palette safely versatile.)"
      : "",
    colorLines.length ? ["", "SITE COLORS (real, from the actual website):", ...colorLines].join("\n") : "",
    fontLines.length ? ["", "SITE FONTS (real, from the actual website):", ...fontLines].join("\n") : "",
    "",
    "FONT PAIRINGS (choose one by key):",
    ...pairingLines,
    "",
    "Call save_brand_identity with a palette and font pairing that fit this brand.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
