import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { CampaignBrief, TopicContext } from "@/lib/db/types";
import {
  buildBrandVoiceBlock,
  buildCampaignBriefBlock,
  buildGuidelinesBlock,
  buildPositioningBlock,
} from "./brand-voice";
import { buildOfferBlock, resolveCta } from "./generate-email";

// Blog generation mirrors the email path's reliable pattern: brand blocks from
// prompts/brand-voice.ts verbatim + a FORCED save_blog_draft tool call, never
// free-form JSON. Section bodies are constrained markdown that
// lib/blog/to-portable-text.ts converts losslessly for Sanity.

export const BlogDraftSchema = z.object({
  title: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    ),
  meta_title: z.string().min(1),
  meta_description: z.string().min(1),
  intro: z.string().min(1),
  sections: z
    .array(z.object({ heading: z.string().min(1), body: z.string().min(1) }))
    .min(2),
  conclusion: z.string().min(1),
  cta_text: z.string().min(1),
  cta_url: z.string().optional(),
});

export type BlogDraftOutput = z.infer<typeof BlogDraftSchema>;

export const BLOG_TOOL: Anthropic.Tool = {
  name: "save_blog_draft",
  description: "Save the finished blog post. Call exactly once with every field filled.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The post's H1/title. Contains the target keyword naturally. Under 70 characters.",
      },
      slug: {
        type: "string",
        description: "URL slug: lowercase words joined by hyphens, keyword-bearing, no dates.",
      },
      meta_title: {
        type: "string",
        description: "SEO title tag, under 60 characters, keyword near the front.",
      },
      meta_description: {
        type: "string",
        description: "SEO meta description, 140 to 160 characters, includes the keyword, ends with a reason to click.",
      },
      intro: {
        type: "string",
        description: "Opening 1 to 2 paragraphs in markdown. The target keyword appears in the first 100 words.",
      },
      sections: {
        type: "array",
        description: "3 to 6 body sections. Each heading is an H2 (plain text, no # marks).",
        items: {
          type: "object",
          properties: {
            heading: {
              type: "string",
              description: "Plain-text H2 heading. At least one section heading includes the target keyword.",
            },
            body: {
              type: "string",
              description:
                "Section body in constrained markdown: paragraphs, - bullet lists, 1. numbered lists, **bold**, *italic*, [text](https://url) links. No #headings, no images, no HTML, no tables.",
            },
          },
          required: ["heading", "body"],
        },
      },
      conclusion: {
        type: "string",
        description: "Closing paragraph(s) in markdown: the takeaway, then a natural bridge to the CTA.",
      },
      cta_text: {
        type: "string",
        description: "Action plus value ('Get my content plan'), never 'Click here'.",
      },
      cta_url: {
        type: "string",
        description: "Where the CTA links, if a product/offer URL is available.",
      },
    },
    required: [
      "title",
      "slug",
      "meta_title",
      "meta_description",
      "intro",
      "sections",
      "conclusion",
      "cta_text",
    ],
  },
};

/** Builds the (system, user) message pair for blog generation. */
export function buildBlogMessages(
  ctx: TopicContext,
  opts: { brief?: CampaignBrief | null } = {},
): { system: string; user: string } {
  const { topic, brand } = ctx;
  const guidelinesBlock = buildGuidelinesBlock(brand);
  const voiceBlock = buildBrandVoiceBlock(brand, ctx.primaryIcp, "blog");
  const positioningBlock = buildPositioningBlock(brand);
  const briefBlock = buildCampaignBriefBlock(opts.brief ?? null);
  const offerBlock = buildOfferBlock(ctx);
  const { ctaText } = resolveCta(ctx);

  const system = [
    `You are the blog writer for ${brand.name}. You produce one complete,`,
    "genuinely useful blog post that sounds exactly like the brand and is built",
    "to rank for its target keyword without reading like SEO filler.",
    "",
    guidelinesBlock,
    voiceBlock,
    positioningBlock,
    "",
    "WRITING PRINCIPLES:",
    "- Lead with the reader's problem or outcome; the brand earns its place after.",
    "  Second person, active voice, cut hedging ('just', 'we think', 'maybe').",
    "- Teach something real in every section: concrete steps, numbers, examples,",
    "  and named outcomes over adjectives. A reader should be able to act on it.",
    "- One post, one job: everything builds toward the single CTA at the end.",
    "",
    "SEO RULES (enforced, not optional):",
    "- ONE idea per heading, logical H2 flow (heading text only, the H1 is the title).",
    "- The target keyword appears in: the title, the first 100 words of the intro,",
    "  and at least one section heading. Naturally, never stuffed.",
    "- meta_title under 60 characters, keyword near the front. meta_description",
    "  140 to 160 characters with the keyword and a reason to click.",
    "- Slug: short, lowercase, hyphenated, keyword-bearing.",
    "- Weave the provided INTERNAL LINKS into the body as [anchor text](url)",
    "  markdown links where they genuinely help the reader; skip any that don't fit.",
    "",
    "FORMAT RULES:",
    "- Section bodies are constrained markdown: paragraphs, - bullets, 1. numbered",
    "  lists, **bold**, *italic*, [text](https://url). NO #headings inside bodies,",
    "  NO images, NO HTML, NO tables.",
    "- NEVER use em dashes or double-hyphens as punctuation. Use a comma, colon, or period.",
    "- Call the save_blog_draft tool once with every field filled. No prose outside it.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    "Write one blog post.",
    "",
    briefBlock,
    `TITLE / TOPIC: ${topic.title}`,
    topic.target_keyword ? `TARGET KEYWORD: ${topic.target_keyword}` : "",
    topic.intent ? `SEARCH INTENT: ${topic.intent}` : "",
    topic.funnel_stage ? `FUNNEL STAGE: ${topic.funnel_stage}` : "",
    ctaText ? `CALL TO ACTION (use this, adapted to action + value): ${ctaText}` : "",
    offerBlock,
    topic.internal_link_targets?.length
      ? [
          "INTERNAL LINKS (work these in as markdown links where they help):",
          ...topic.internal_link_targets.map((l) => `  - ${l}`),
        ].join("\n")
      : "",
    "",
    "Call save_blog_draft now.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}
