import type { BrandTokens } from "@/lib/email/templates/types";
import type {
  ContentImage,
  EmailTemplateId,
  HeroPlacement,
  StyleReference,
  VisualVibe,
} from "@/lib/db/types";
import { EMAIL_STYLES, type EmailStyleDirective } from "./email-styles";

// The default accent discipline: color is a signal, not a theme.
const ACCENT_BUDGET_DEFAULT = [
  "ACCENT BUDGET (non-negotiable; brand presence comes from typography, spacing,",
  "and the logo, not color coverage):",
  "- The accent color appears at FULL strength in at most 2 to 3 places in the",
  "  whole email. The CTA button is always one of them; the style direction below",
  "  names the other one or two. Everything else stays neutral (the body text,",
  "  muted, and background tokens, plus grays and near-whites derived from them).",
  "- Where a style calls for an accent-tinted fill (callout backgrounds, chips,",
  "  soft bands), use a very light tint of the accent, roughly 8 to 12% strength",
  "  mixed toward white, with normal dark body text on it. Never place body copy",
  "  on a solid full-strength accent background.",
  "- Headlines and subheadings use the primary color, never the accent.",
  "- When in doubt, leave it neutral: an email with too little accent still looks",
  "  professional; one painted in brand color looks like a coupon.",
];

// Loosened for a punchy/playful visual_vibe: still composed, just louder.
const ACCENT_BUDGET_VIBRANT = [
  "ACCENT BUDGET (loosened for this piece's punchy/playful vibe; still deliberate,",
  "never a wall of color):",
  "- The accent color can appear at full strength in up to 4 or 5 places: the CTA,",
  "  the style's usual accent moment, plus one or two extra, a callout fill, a",
  "  chip, a small block of color behind the eyebrow or a stat.",
  "- A second brand color (the secondary token) may join the accent as a light",
  "  tint on ONE section background for contrast, e.g. alternating a section's",
  "  backdrop; keep body text at WCAG-AA contrast on it.",
  "- Headlines still use the primary color; the accent stays reserved for",
  "  deliberate moments, never running body text.",
  "- Energetic and colorful still means composed: never more than 2 distinct",
  "  brand hues visible at once outside the logo.",
];

// Where the design prompt tells the model to put the hero image; mirrors the
// code-level anchors in spliceHeroImage so prompt and splice never disagree.
const HERO_PLACEMENT_DIRECTIVES: Record<HeroPlacement, string> = {
  top: "directly ABOVE the headline (below the header/eyebrow), full column width.",
  below_headline:
    "directly BELOW the headline, before the body copy, full column width.",
  above_cta:
    "directly ABOVE the call-to-action button, after the body copy, full column width.",
};

// The codified email design system: every generated email is designed under
// this brief. It encodes the constraints email clients actually impose (email
// HTML is not browser HTML) so "modern" never breaks in Outlook or Gmail, and
// it injects the brand's real tokens so the design is the brand's, not generic.
//
// The model designs the full HTML; code-level guarantees (unsubscribe tag,
// em-dash strip, validation with template fallback) live in lib/pipeline.

const LAYOUT_SHAPES: Record<EmailTemplateId, string> = {
  newsletter_tip:
    "QUICK TIP layout: an uppercase accent eyebrow (e.g. QUICK TIP), one sharp headline, " +
    "the tip set in a visually distinct callout (soft background, accent left border, " +
    "rounded right corners), then the CTA button. Short and punchy; one body section.",
  newsletter_feature:
    "EDITORIAL FEATURE layout: an uppercase accent eyebrow, a larger headline, a lead " +
    "paragraph set bigger and lighter than body text, then 2 to 3 sections each with a " +
    "small bold subheading, separated by thin hairline dividers, then the CTA button.",
  newsletter_howto:
    "STEP-BY-STEP layout: an uppercase accent eyebrow, one headline, a short lead-in, " +
    "then numbered steps where each number sits in a small accent-colored circle or badge " +
    "beside a bold step title and its body copy, then the CTA button.",
  promotional_bold:
    "PROMOTIONAL layout: minimal chrome, one bold offer headline, a short urgency or " +
    "deadline line, one large dominant CTA button placed above the fold, and an optional " +
    "brief fine-print line below it in muted text. No lengthy sections; brief beats long.",
  announcement_banner:
    "ANNOUNCEMENT layout: the news stated plainly up top as the headline, one short " +
    "paragraph explaining why it matters to the reader, then the CTA button. Confident " +
    "and clean, minimal decoration, informative rather than salesy.",
  product_spotlight:
    "PRODUCT SPOTLIGHT layout: an uppercase eyebrow naming the category, a headline " +
    "focused on the outcome the reader gets, a short feature list (2 to 4 short lines " +
    "each led by a small accent marker or checkmark), then the CTA button.",
  digest:
    "DIGEST layout: an uppercase accent eyebrow, one short intro line, then 3 to 5 " +
    "compact items each with a bold lead-in phrase followed by one supporting sentence " +
    "(numbered or marker-led), then the CTA button. Scannable, not narrative.",
};

/**
 * The footer spec inside "Required chrome": a designed footer, not an
 * afterthought — wordmark, contact line, social badge row (from the brand's
 * saved social links), postal address, permission line, unsubscribe. Mirrors
 * the code template's renderFooter so model-designed and template-rendered
 * emails end at the same place.
 */
function buildFooterChrome(tokens: BrandTokens): string[] {
  const footer = tokens.footer;
  const social = footer.social ?? {};
  const socialEntries: [string, string, string | undefined][] = [
    ["LinkedIn", "in", social.linkedin],
    ["X", "X", social.twitter],
    ["Instagram", "ig", social.instagram],
    ["YouTube", "yt", social.youtube],
  ];
  const socialLines = socialEntries
    .filter(([, , href]) => href)
    .map(([name, glyph, href]) => `    - ${name} ("${glyph}"): ${href}`);

  return [
    "- Footer (its wrapper carries data-region=\"footer\"), centered, small muted text,",
    "  separated from the body by a thin top hairline or generous space (per the style),",
    "  stacked in this order:",
    `  1) the sender wordmark: "${tokens.logo_alt}" small (about 15px) in the heading font,`,
    "     bold, with an accent-colored period" +
      (footer.website ? `, linked to ${footer.website}` : "") +
      ".",
    "  2) a muted contact line" +
      (footer.website ? `: the bare domain of ${footer.website}` : "") +
      (footer.contact_email
        ? `${footer.website ? ", a middot separator, and" : ":"} ${footer.contact_email} (mailto link)`
        : "") +
      ".",
    ...(socialLines.length
      ? [
          "  3) a social row: one circular badge link per network, a 28px circle with a very",
          "     light neutral fill and the muted-color bold glyph text shown below (never an",
          "     external icon image; text glyphs survive every client). Link each to its URL:",
          ...socialLines,
        ]
      : []),
    ...(footer.postal_address
      ? [
          `  4) the postal address "${footer.postal_address}" at 11px (marketing-email law requires it).`,
        ]
      : []),
    `  5) a short permission line ("You're receiving this email because you subscribed to`,
    `     updates from ${tokens.sender_name}.") at 11px,`,
    "  6) and REQUIRED: an unsubscribe link whose href is the literal merge tag {$unsubscribe}.",
  ];
}

/**
 * Builds the email design brief for the generation system prompt: layout
 * direction for this email's shape plus the hard email-HTML rules and the
 * brand's visual tokens.
 */
export function buildEmailDesignBrief(
  tokens: BrandTokens,
  templateId: EmailTemplateId,
  opts: {
    heroImage?: ContentImage;
    style?: EmailStyleDirective;
    vibe?: VisualVibe;
  } = {},
): string {
  const c = tokens.colors;
  const f = tokens.fonts;
  const hero = opts.heroImage;
  // Defaults to the safe baseline look when no style is passed (keeps every
  // existing call site, and any legacy path, producing a valid brief).
  const style = opts.style ?? EMAIL_STYLES.soft_card;
  const accentBudget =
    opts.vibe === "punchy" || opts.vibe === "playful"
      ? ACCENT_BUDGET_VIBRANT
      : ACCENT_BUDGET_DEFAULT;

  return [
    "EMAIL DESIGN SYSTEM (follow exactly; email HTML is not browser HTML):",
    "",
    "Structure:",
    "- Produce ONE complete HTML document: <!DOCTYPE html>, <html lang=\"en\">,",
    "  <head> with <meta charset> + viewport meta + <title>, and <body>.",
    "- Also in <head>: <meta name=\"color-scheme\" content=\"light dark\"> AND",
    "  <meta name=\"supported-color-schemes\" content=\"light dark\"> (required for",
    "  the dark-mode block below to take effect instead of client auto-inversion).",
    "- Immediately inside <body>, a hidden preheader div (display:none;max-height:0;",
    "  overflow:hidden) containing the preheader text, padded with repeated",
    "  '&#847;&zwnj;&nbsp;' so body copy never leaks into the inbox preview line.",
    "- Layout with nested <table role=\"presentation\"> elements (Outlook-safe), never",
    "  CSS grid, flexbox, floats, or position.",
    "- One centered single-column card, width 600px (max-width:600px), generous outer",
    "  padding. The card's exact corner radius, border, top accent treatment, and page",
    "  background come from the STYLE DIRECTION section below, not a fixed default.",
    "",
    "REGIONS (required, enables click-to-edit in the review UI): add a data-region",
    "attribute to the element that wraps each of these parts, exactly one value each:",
    "  data-region=\"header\" on the logo/wordmark block, \"eyebrow\" on the uppercase",
    "  kicker (if this layout has one), \"headline\" on the <h1>, \"body\" on the wrapper",
    "  around the main body copy (wrap each distinct section's copy in its own",
    "  data-region=\"body\" element if there are several), \"cta\" on the button's",
    "  wrapping element, and \"footer\" on the footer block. When the IMAGE block",
    "  below provides a hero image, its wrapper carries data-region=\"image\".",
    "  data-* attributes are invisible and never affect rendering, so add them freely.",
    "",
    "CSS rules:",
    "- ALL styles inline on elements. No external stylesheets, no <link>, no JavaScript,",
    "  no web-font imports (brand font stacks below are already email-safe).",
    "- A single <style> block in <head> may ONLY hold @media tweaks for mobile and the",
    "  dark-mode block below; the email must look correct even if it's stripped.",
    "",
    "DARK MODE (automatic; the light design stays the base):",
    "- Give stable class names to the page background element (e.g. em-bg), the card",
    "  (em-card), headings (em-heading), body copy wrappers (em-text), and the footer",
    "  (em-muted). Classes are invisible in clients that ignore them.",
    "- In the <style> block, add @media (prefers-color-scheme: dark) rules that restyle",
    "  exactly those classes, each declaration with !important (head CSS must beat the",
    "  inline styles): a near-black page background, a slightly lighter dark card",
    "  surface, near-white headings, soft light-gray body text, muted-but-readable",
    "  footer. Keep the accent (top bar, CTA button) unchanged, its white button text",
    "  already reads on dark. Never invert or restyle images.",
    "- Dark rules live ONLY inside that media query, so clients that strip <style>",
    "  still get the correct light email.",
    hero
      ? "- Images: ONLY the brand logo (if provided) and the hero image specified in" +
        " the IMAGE block below. Never invent or reference any other image."
      : "- Images: only the brand logo if a URL is provided; always with alt text. Never" +
        " reference other external images.",
    ...(hero
      ? [
          "",
          "IMAGE (this email has a generated hero image; place it):",
          `- Insert <tr><td data-region="image" align="center" style="padding:0 48px 28px;">`,
          `  <img src="${hero.url}" alt="${hero.alt.replace(/"/g, "&quot;")}" width="552"`,
          `  style="display:block;width:100%;max-width:100%;height:auto;border:0;`,
          `  border-radius:12px;" /></td></tr> as its own table row, a sibling of the`,
          `  other region rows. Never a bare <div> dropped between <td> cells: it isn't`,
          `  valid inside a <tr>, and mail clients silently relocate it out of the table.`,
          `  ${HERO_PLACEMENT_DIRECTIVES[hero.placement ?? "top"]}`,
          "- Keep it a real <img>, never a CSS background-image (Outlook drops those).",
          "- Keep the copy prominent: one hero image plus real body text, never an",
          "  image-heavy layout (spam filters penalize low text-to-image ratios).",
        ]
      : []),
    "",
    "Readability (non-negotiable):",
    "- Body copy 16px, line-height 1.6 to 1.7, never wider than the 600px column with",
    "  at least 40px side padding inside the card.",
    "- Clear hierarchy: ONE headline (28 to 32px, tight letter-spacing), scannable",
    "  sections, short paragraphs (1 to 3 sentences each).",
    "- Exactly ONE dominant call-to-action: a bulletproof button, an <a> styled",
    "  display:inline-block with the accent background, white text, 15px+ vertical",
    "  padding, rounded corners. Text links may support it; nothing competes with it.",
    "- Color contrast must stay comfortably readable (body text on background at",
    "  WCAG-AA-level contrast or better).",
    "",
    "Required chrome:",
    tokens.logo_url
      ? `- Header: the brand logo <img src="${tokens.logo_url}" alt="${tokens.logo_alt}"> capped at max-width:170px;max-height:48px, positioned and divided from the body per the STYLE DIRECTION below.`
      : `- Header: a typographic wordmark, "${tokens.logo_alt}" in the heading font, bold, with a period after it colored in the accent, positioned and divided from the body per the STYLE DIRECTION below.`,
    ...buildFooterChrome(tokens),
    "",
    "BRAND TOKENS (the default palette; use these exact values UNLESS the",
    "instruction below explicitly asks for a different color, tone, or look",
    "for this piece, in which case follow that explicit request instead):",
    `- Primary (headlines, wordmark): ${c.primary}`,
    `- Secondary (lead paragraph): ${c.secondary}`,
    `- Accent (CTA button, plus one or two deliberate moments per the style direction): ${c.accent}`,
    `- Card background: ${c.background}`,
    `- Body text: ${c.text}`,
    `- Muted (footer, meta): ${c.muted}`,
    `- Heading font stack: ${f.heading}`,
    `- Body font stack: ${f.body}`,
    "",
    ...accentBudget,
    "",
    "STYLE DIRECTION FOR THIS EMAIL (this piece's visual identity; the exact spacing,",
    "sizing, and detail choices within it are yours, but every EMAIL DESIGN SYSTEM rule",
    "above and below, dark mode, data-regions, one CTA, {$unsubscribe}, WCAG-AA contrast,",
    "still applies underneath it without exception):",
    `- Style: ${style.label}`,
    ...style.lines.map((l) => `  ${l}`),
    "",
    "LAYOUT FOR THIS EMAIL:",
    `- ${LAYOUT_SHAPES[templateId]}`,
    "",
    "Design taste: modern and confident, generous whitespace, accent used sparingly",
    "and deliberately per the style direction above. Never cram; when in doubt, add",
    "space. NEVER use em dashes or en dashes anywhere in the HTML or copy.",
  ].join("\n");
}

/**
 * The block that tells the model to rebuild an uploaded email design (migration
 * 016). Injected right after the design brief, so it can override the generic
 * layout direction above it while the hard EMAIL DESIGN SYSTEM rules (600px
 * card, inline styles, dark mode, {$unsubscribe}) still win over both.
 *
 * Only the NEWEST email-kind reference is used, deliberately: recreation means
 * reproducing ONE design, and blending two references produces neither, at
 * double the image tokens.
 *
 * This is the text half. The actual screenshot is attached to the user turn by
 * loadEmailDesignReference in lib/pipeline/generate.ts; the notes here are what
 * Claude distilled from that same image at upload time.
 */
export function buildDesignReferenceBlock(refs: StyleReference[] | undefined): string {
  const ref = refs?.[0];
  if (!ref) return "";

  const recreate = (ref.mode ?? "recreate") === "recreate";
  const profile = ref.design_profile;

  const instruction = recreate
    ? [
        "A reference email design is ATTACHED TO THIS MESSAGE AS AN IMAGE. RECREATE its",
        "design: reproduce its layout structure, the order and proportion of its sections,",
        "its spacing rhythm, its type hierarchy, and its button treatment in your HTML.",
        "Swap in THIS brand's colors, fonts, logo, and the copy you write. Never reproduce",
        "the reference's brand, its logo, its images, or its words: you are rebuilding the",
        "shape, not copying the email.",
      ]
    : [
        "A reference email design is ATTACHED TO THIS MESSAGE AS AN IMAGE. Take its overall",
        "look and mood as inspiration: its density, its visual weight, how it spends color",
        "and space. Do not copy its layout section by section, and never reproduce its",
        "brand, images, or words.",
      ];

  return [
    recreate ? "REFERENCE EMAIL DESIGN (RECREATE THIS):" : "REFERENCE EMAIL DESIGN (INSPIRATION):",
    ...instruction,
    "The EMAIL DESIGN SYSTEM rules above (600px card, inline styles, dark-mode classes,",
    "one CTA, {$unsubscribe} in the footer, WCAG-AA contrast) still apply and WIN on any",
    "conflict with the reference. If the reference does something an email client can't do,",
    "do the closest thing that survives Outlook and Gmail.",
    ...(recreate
      ? [
          "Where the reference's structure and the LAYOUT FOR THIS EMAIL above disagree, the",
          "reference wins: recreating it is the point.",
        ]
      : []),
    ...(profile
      ? [
          "",
          `What the design looks like: ${profile.summary}`,
          "Its sections, top to bottom:",
          ...profile.layout.map((section, i) => `  ${i + 1}. ${section}`),
          ...(profile.palette_notes ? [`How it uses color: ${profile.palette_notes}`] : []),
          ...(profile.typography_notes ? [`Its type hierarchy: ${profile.typography_notes}`] : []),
        ]
      : [
          "",
          "(No distilled notes for this one: read the attached image directly.)",
        ]),
  ].join("\n");
}
