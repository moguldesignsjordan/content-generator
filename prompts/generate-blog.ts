import { z } from "zod";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { BlogType, CampaignBrief, TopicContext } from "@/lib/db/types";
import {
  buildBrandVoiceBlock,
  buildCampaignBriefBlock,
  buildGuidelinesBlock,
  buildKeywordLines,
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
        description: "Body sections; use the count from LENGTH FOR THIS POST. Each heading is an H2 (plain text, no # marks).",
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

// Per-type length budgets for blogs. blog_type is the axis that decides how
// long and deep a post should be. These ranges are injected into the prompt as
// a hard constraint and enforced after generation (see countBlogWords + the
// retry in generate-blog.ts). The companion to EMAIL_LENGTH_TARGETS.
export interface BlogLengthTarget {
  words: [number, number];
  sections: [number, number];
  directive: string;
}

export const BLOG_LENGTH_TARGETS: Record<BlogType, BlogLengthTarget> = {
  pillar: {
    words: [2500, 4000],
    sections: [5, 8],
    directive:
      "a comprehensive pillar resource. Cover the topic end to end with real depth: what it is, why it matters, a structured walkthrough of every major facet, concrete examples, common mistakes, and the questions a reader will have next. This should be the definitive piece someone bookmarks.",
  },
  how_to: {
    words: [1500, 2500],
    sections: [4, 7],
    directive:
      "an actionable tutorial. Lay out the process as clear numbered steps, each with what to do, why it matters, and a concrete example or pitfall. A reader should be able to follow it start to finish and get a result.",
  },
  listicle: {
    words: [1500, 2500],
    sections: [5, 10],
    directive:
      "a listicle with one section per item. Give each item a bold heading and a substantive paragraph or two of real explanation with an example, not a one-liner. Depth per item is the point.",
  },
  case_study: {
    words: [1500, 2500],
    sections: [4, 6],
    directive:
      "a case study. Structure it as the client and their problem, the approach, what was actually done, the real results (with numbers when the brief or brand facts actually give you one, otherwise describe the concrete outcome without inventing a figure), and the takeaways. Specific and concrete throughout, never generic.",
  },
  thought_leadership: {
    words: [1000, 1800],
    sections: [3, 5],
    directive:
      "a point-of-view piece. Take a clear stance, argue it with reasoning and examples, acknowledge the counterpoint, and land a memorable takeaway. Voice-forward, not SEO-mechanical.",
  },
  landing: {
    words: [800, 1500],
    sections: [3, 5],
    directive:
      "an SEO landing page for the offer. Lead with the outcome, then what it is, who it is for, how it works, proof, and the CTA. Persuasive and scannable, shorter than a pillar.",
  },
};

/**
 * Derives the blog format from the topic's title and search intent. The title
 * usually announces the format ("How to...", "7 Signs...", "Case Study:..."),
 * so this is stable and free. Priority:
 *   1. commercial/transactional intent with a mapped offer -> landing
 *   2. case study in title or intent -> case_study
 *   3. how-to / tutorial signals -> how_to
 *   4. listicle title ("N <things>") -> listicle
 *   5. brand stage / opinion intent -> thought_leadership
 *   6. otherwise -> pillar (the comprehensive default)
 */
export function resolveBlogType(
  topic: { title: string; intent: string | null; funnel_stage: string | null; maps_to_product: string | null },
  opts: { brief?: CampaignBrief | null; override?: BlogType } = {},
): BlogType {
  if (opts.override) return opts.override;

  const title = topic.title.toLowerCase();
  const intent = (topic.intent ?? "").toLowerCase();

  if (
    topic.maps_to_product &&
    (intent.includes("commercial") ||
      intent.includes("transactional") ||
      intent.includes("buy"))
  ) {
    return "landing";
  }

  if (title.includes("case study") || intent.includes("case study")) {
    return "case_study";
  }

  if (
    /^(how to|how do i|guide to|tutorial|step|steps to)/.test(title) ||
    intent.includes("how to") ||
    intent.includes("tutorial")
  ) {
    return "how_to";
  }

  if (
    /^\d+\s+(best|top|ways|tips|signs|reasons|tools|ideas|strategies|steps|questions|things)/.test(
      title,
    )
  ) {
    return "listicle";
  }

  if (topic.funnel_stage === "brand" || intent.includes("opinion")) {
    return "thought_leadership";
  }

  return "pillar";
}

/** Total word count of a blog post: intro + every section body + conclusion. */
export function countBlogWords(copy: {
  intro: string;
  sections: { body: string }[];
  conclusion: string;
}): number {
  const parts = [copy.intro, ...copy.sections.map((s) => s.body), copy.conclusion];
  return parts.reduce(
    (sum, p) => sum + p.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
}

/** Builds the (system, user) message pair for blog generation. */
export function buildBlogMessages(
  ctx: TopicContext,
  opts: {
    brief?: CampaignBrief | null;
    blogTypeOverride?: BlogType;
    rejection?: { feedback: string; previousTitle: string; previousMetaDescription: string };
  } = {},
): { system: string; user: string; blogType: BlogType } {
  const { topic, brand } = ctx;
  const guidelinesBlock = buildGuidelinesBlock(brand);
  const voiceBlock = buildBrandVoiceBlock(brand, ctx.primaryIcp, "blog");
  const positioningBlock = buildPositioningBlock(brand);
  const briefBlock = buildCampaignBriefBlock(opts.brief ?? null);
  const offerBlock = buildOfferBlock(ctx, opts.brief);
  const { ctaText } = resolveCta(ctx);
  const blogType = resolveBlogType(topic, {
    brief: opts.brief ?? null,
    override: opts.blogTypeOverride,
  });
  const length = BLOG_LENGTH_TARGETS[blogType];

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
    "  and named outcomes over adjectives, when a real one is available (see",
    "  below). A reader should be able to act on it.",
    "- One post, one job: everything builds toward the single CTA at the end.",
    "- Never invent numbers, statistics, dates, prices, testimonials, or customer",
    "  names. Use only what the CAMPAIGN BRIEF, the offer block, or the brand",
    "  facts above give you. With no real number available, get concrete WITHOUT",
    "  one: name the specific situation, object, or step instead. An invented",
    "  specific is worse than an honest general.",
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
    `BLOG TYPE: ${blogType}`,
    `LENGTH FOR THIS POST (required, not optional): ${length.words[0]} to ${length.words[1]} words total across ${length.sections[0]} to ${length.sections[1]} sections. This is ${blogType === "landing" ? `an ${blogType}` : `a ${blogType.replace(/_/g, " ")}`} post: ${length.directive} The intro plus section bodies plus conclusion together must reach ${length.words[0]} words.`,
    `TITLE / TOPIC: ${topic.title}`,
    ...buildKeywordLines(topic),
    topic.funnel_stage ? `FUNNEL STAGE: ${topic.funnel_stage}` : "",
    ctaText ? `CALL TO ACTION (use this, adapted to action + value): ${ctaText}` : "",
    offerBlock,
    topic.internal_link_targets?.length
      ? [
          "INTERNAL LINKS (work these in as markdown links where they help):",
          ...topic.internal_link_targets.map((l) => `  - ${l}`),
        ].join("\n")
      : "",
    ...(opts.rejection
      ? [
          "",
          "REVISION REQUEST: address this feedback in the new version:",
          `FEEDBACK: ${opts.rejection.feedback}`,
          `PREVIOUS TITLE WAS: ${opts.rejection.previousTitle}`,
          `PREVIOUS META DESCRIPTION WAS: ${opts.rejection.previousMetaDescription}`,
          "Write a meaningfully different post that fixes these issues.",
        ]
      : []),
    "",
    "Call save_blog_draft now.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user, blogType };
}
