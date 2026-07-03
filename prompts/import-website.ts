import type { Anthropic } from "@anthropic-ai/sdk";
import type { ScrapeResult } from "@/lib/scrape/types";

// Brand extraction from a scraped website: one forced tool call turns page
// text + deterministic signals into a flat proposal the route maps onto the
// nested brand shapes. Everything is a PROPOSAL; the human reviews and saves.
//
// Anti-hallucination contract (load-bearing): colors, fonts, and the logo may
// ONLY be chosen from the candidate lists extracted in code, and every field
// must be evidenced by the site or omitted. The route re-validates the color
// and logo choices against the candidates and drops violations.

export interface ImportProductInput {
  slug?: string;
  name?: string;
  description?: string;
  deliverables?: string[];
  price_point?: string;
  url?: string;
}

export interface ImportToolInput {
  // voice
  voice?: string;
  tone?: string;
  example_lines?: string[];
  banned_terms?: string[];
  // positioning
  business_description?: string;
  tagline?: string;
  differentiators?: string[];
  competitors?: string[];
  // audience
  audience_summary?: string;
  // products
  products?: ImportProductInput[];
  // visual identity
  color_primary?: string;
  color_secondary?: string;
  color_accent?: string;
  color_background?: string;
  color_text?: string;
  color_muted?: string;
  font_heading?: string;
  font_body?: string;
  logo_url?: string;
  logo_alt?: string;
  // footer
  contact_email?: string;
  social_linkedin?: string;
  social_twitter?: string;
  social_instagram?: string;
  social_youtube?: string;
}

const OMIT = "Omit this field entirely if the site doesn't evidence it. Never invent.";

export const IMPORT_TOOL: Anthropic.Tool = {
  name: "save_brand_extraction",
  description:
    "Return the brand information extracted from the website pages provided. " +
    "Every field must be grounded in what the site actually says or shows; " +
    "omit anything you cannot support. Never invent facts, offers, pricing, " +
    "colors, or fonts.",
  input_schema: {
    type: "object",
    properties: {
      voice: {
        type: "string",
        description: `2-4 sentences describing how this brand writes: register, energy, sentence rhythm, personality. Derived from the site copy itself. ${OMIT}`,
      },
      tone: {
        type: "string",
        description: `1-2 sentences on emotional tone (e.g. confident but warm). ${OMIT}`,
      },
      example_lines: {
        type: "array",
        items: { type: "string" },
        description: `3-6 VERBATIM sentences copied from the site that best show how the brand writes. Exact quotes only, no paraphrasing. ${OMIT}`,
      },
      banned_terms: {
        type: "array",
        items: { type: "string" },
        description: `Words/phrases the site explicitly positions itself against, if any. Rarely present. ${OMIT}`,
      },
      business_description: {
        type: "string",
        description: `2-3 sentences: what the business does, for whom, stated plainly. ${OMIT}`,
      },
      tagline: {
        type: "string",
        description: `The site's actual tagline or hero headline, verbatim. ${OMIT}`,
      },
      differentiators: {
        type: "array",
        items: { type: "string" },
        description: `Claims the site makes about why it wins (short phrases). ${OMIT}`,
      },
      competitors: {
        type: "array",
        items: { type: "string" },
        description: `Competitors or alternatives the site names directly. ${OMIT}`,
      },
      audience_summary: {
        type: "string",
        description: `2-3 sentences on who the site is clearly speaking to and what they care about. ${OMIT}`,
      },
      products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "kebab-case of the offer name, e.g. brand-strategy-sprint",
            },
            name: { type: "string", description: "The offer's name as the site states it." },
            description: {
              type: "string",
              description: "1-2 sentences on what the offer is, from the site.",
            },
            deliverables: {
              type: "array",
              items: { type: "string" },
              description: "Scope items ONLY if the page states them.",
            },
            price_point: {
              type: "string",
              description: "ONLY if a price is actually shown on the site, verbatim.",
            },
            url: { type: "string", description: "The page URL describing this offer." },
          },
          required: ["slug", "name"],
        },
        description: `One entry per distinct product/service/package the site offers. ${OMIT}`,
      },
      color_primary: {
        type: "string",
        description: `Main brand color for headlines/wordmark. MUST be a hex from the CANDIDATE COLORS list. ${OMIT}`,
      },
      color_secondary: {
        type: "string",
        description: `Supporting color. MUST be from CANDIDATE COLORS. ${OMIT}`,
      },
      color_accent: {
        type: "string",
        description: `The CTA/button/highlight color. MUST be from CANDIDATE COLORS. ${OMIT}`,
      },
      color_background: {
        type: "string",
        description: `Main page/card background color. MUST be from CANDIDATE COLORS. ${OMIT}`,
      },
      color_text: {
        type: "string",
        description: `Body text color. MUST be from CANDIDATE COLORS. ${OMIT}`,
      },
      color_muted: {
        type: "string",
        description: `Muted/footer/meta text color. MUST be from CANDIDATE COLORS. ${OMIT}`,
      },
      font_heading: {
        type: "string",
        description: `Heading font stack chosen from FONT CANDIDATES, as a usable CSS font-family string. ${OMIT}`,
      },
      font_body: {
        type: "string",
        description: `Body font stack chosen from FONT CANDIDATES. ${OMIT}`,
      },
      logo_url: {
        type: "string",
        description: `The brand's logo. MUST be a URL from the LOGO CANDIDATES list. ${OMIT}`,
      },
      logo_alt: {
        type: "string",
        description: `Short alt text for the logo (usually the brand name). ${OMIT}`,
      },
      contact_email: {
        type: "string",
        description: `Contact email from the CONTACT signals. ${OMIT}`,
      },
      social_linkedin: { type: "string", description: `From SOCIAL signals only. ${OMIT}` },
      social_twitter: { type: "string", description: `From SOCIAL signals only. ${OMIT}` },
      social_instagram: { type: "string", description: `From SOCIAL signals only. ${OMIT}` },
      social_youtube: { type: "string", description: `From SOCIAL signals only. ${OMIT}` },
    },
  },
};

/** Builds the (system, user) pair for one extraction call. */
export function buildImportMessages(scrape: ScrapeResult): {
  system: string;
  user: string;
} {
  const system = [
    "You are a brand analyst. You read a business's website and extract its",
    "brand profile: how it sounds, how it positions itself, what it sells, and",
    "how it looks. You work ONLY from the material provided.",
    "",
    "RULES:",
    "- Extract, never invent. If the site doesn't evidence a field, omit it.",
    "- example_lines are verbatim quotes from the site, chosen for voice, not topic.",
    "- Colors, fonts, and logo MUST come from the candidate lists provided;",
    "  assign roles thoughtfully (accent = the color used for buttons/CTAs and",
    "  highlights; background and text should read comfortably together).",
    "- Products: one entry per distinct offer. price_point only if a price is",
    "  literally shown. deliverables only if scope is stated.",
    "- NEVER use em dashes in any text you write. Use a comma, colon, or period.",
    "- Call save_brand_extraction once with everything you found.",
  ].join("\n");

  const s = scrape.signals;
  const colorLines = s.color_candidates.length
    ? s.color_candidates.map(
        (c) => `  ${c.hex} (seen ${c.count}x${c.source === "css-var" ? ", css variable: strong brand signal" : ""})`,
      )
    : ["  (none found)"];
  const fontLines = s.font_candidates.length
    ? s.font_candidates.map((f) => `  ${f}`)
    : ["  (none found)"];
  const logoLines = s.logo_candidates.length
    ? s.logo_candidates.map((u) => `  ${u}`)
    : ["  (none found)"];

  const signalBlock = [
    "SITE SIGNALS (extracted from the HTML/CSS in code; trustworthy):",
    s.site_name ? `Site name: ${s.site_name}` : "",
    s.meta_description ? `Meta description: ${s.meta_description}` : "",
    "",
    "CANDIDATE COLORS (choose color roles ONLY from these):",
    ...colorLines,
    "",
    "FONT CANDIDATES (choose fonts ONLY from these):",
    ...fontLines,
    "",
    "LOGO CANDIDATES (choose logo_url ONLY from these, best-guess first):",
    ...logoLines,
    "",
    s.emails.length ? `CONTACT: ${s.emails.join(", ")}` : "",
    Object.keys(s.social).length
      ? `SOCIAL: ${Object.entries(s.social)
          .map(([k, v]) => `${k}: ${v}`)
          .join("  ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const pageBlocks = scrape.pages.map((p) =>
    [`PAGE: ${p.url}`, p.title ? `TITLE: ${p.title}` : "", p.text, ""]
      .filter(Boolean)
      .join("\n"),
  );

  const user = [
    `Extract the brand profile for the site at ${scrape.origin}.`,
    "",
    signalBlock,
    "",
    "PAGES:",
    "",
    ...pageBlocks,
    "Call save_brand_extraction with every field the site supports.",
  ].join("\n");

  return { system, user };
}
