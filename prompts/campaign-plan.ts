import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  Brand,
  BrandMemory,
  FactoryKind,
  FactoryResearch,
  Icp,
  Product,
} from "@/lib/db/types";
import {
  buildBrandVoiceBlock,
  buildGuidelinesBlock,
  buildMemoryBlock,
  buildPositioningBlock,
  buildProductLines,
} from "./brand-voice";
import { FLYER_STYLE_CATALOG } from "@/lib/design-styles";
import {
  CAMPAIGN_FORMATS,
  FACTORY_KINDS,
  FACTORY_KIND_LABELS,
} from "./campaign-formats";

// Stage 2 of the campaign factory: turn the research brief into a plan table,
// one row per piece. Each row is a different idea on purpose (its own format,
// hook, and core idea), and any proof the piece needs but nobody has supplied
// is flagged for the owner to fill in instead of being invented.

export const SAVE_PLAN_TOOL: Anthropic.Tool = {
  name: "save_campaign_plan",
  description: "Save the campaign plan: one item per piece of content.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: FACTORY_KINDS },
            format: {
              type: "string",
              enum: CAMPAIGN_FORMATS.map((f) => f.id),
              description: "A format id belonging to this item's kind.",
            },
            title: { type: "string", description: "Short working title for the plan table." },
            hook: {
              type: "string",
              description:
                "The first line the reader sees. Concrete and specific to this business. Unique across the plan.",
            },
            core_idea: {
              type: "string",
              description: "One sentence: the single thing this piece shows or argues. Unique across the plan.",
            },
            key_message: {
              type: "string",
              description: "What the reader should believe or do after this piece.",
            },
            visual: {
              type: "string",
              description:
                "What the picture shows: subject, setting, composition. Show the real product or work when there is one. Never describe text in the image.",
            },
            preview: {
              type: "string",
              description:
                "Email: the subject line, under 50 characters. Blog: the SEO title. Social: the caption's first line. Ad: the primary text's first line.",
            },
            cta: { type: "string", description: "Button text, 2 to 4 words." },
            inspired_by: {
              type: "string",
              description: "The research source URL that sparked this piece, if one did.",
            },
            needs_detail: {
              type: "boolean",
              description:
                "True when this piece needs a real number, result, quote, or story that is NOT in the facts provided.",
            },
            detail_prompt: {
              type: "string",
              description:
                "When needs_detail is true: the exact question to ask the owner, e.g. 'How many sites did you launch this year?'",
            },
            offer_slug: {
              type: "string",
              description: "Slug of the product or service this piece promotes, if any.",
            },
          },
          required: [
            "kind",
            "format",
            "title",
            "hook",
            "core_idea",
            "key_message",
            "preview",
            "needs_detail",
          ],
        },
      },
      flyer_style: {
        type: "string",
        enum: FLYER_STYLE_CATALOG.map((s) => s.id),
        description:
          "One design direction every social post and ad in this campaign shares, so they look like a set. Pick what fits the brand and the offer.",
      },
    },
    required: ["items"],
  },
};

function researchLines(research: FactoryResearch): string[] {
  const finding = (f: { point: string; sources: string[] }) =>
    `  - ${f.point}${f.sources.length ? ` (${f.sources.join(", ")})` : ""}`;
  return [
    "RESEARCH BRIEF",
    `Summary: ${research.summary || "(none)"}`,
    "What's working now:",
    ...(research.trends.length ? research.trends.map(finding) : ["  (nothing found)"]),
    "Competitor patterns:",
    ...(research.competitor_patterns.length
      ? research.competitor_patterns.map(finding)
      : ["  (nothing found)"]),
    "Hook patterns:",
    ...(research.hook_patterns.length
      ? research.hook_patterns.map((h) => `  - ${h}`)
      : ["  (none)"]),
    "REAL FACTS ABOUT THIS BUSINESS (the only facts you may state as true):",
    ...(research.brand_facts.length
      ? research.brand_facts.map(finding)
      : ["  (none found; flag needs_detail wherever proof would help)"]),
  ];
}

function formatLines(kinds: FactoryKind[]): string[] {
  return kinds.flatMap((kind) => [
    `${FACTORY_KIND_LABELS[kind]} (kind "${kind}"):`,
    ...CAMPAIGN_FORMATS.filter((f) => f.kind === kind).map(
      (f) => `  - ${f.id}: ${f.label}. ${f.feel} Concept seeds: ${f.seeds.join("; ")}.`,
    ),
  ]);
}

export function buildPlanMessages(args: {
  brand: Brand;
  primaryIcp: Icp | null;
  products: Product[];
  memories: BrandMemory[];
  sentence: string;
  /** Absent when the owner chose to skip web research. */
  research?: FactoryResearch;
  counts: Record<FactoryKind, number>;
}): { system: string; user: string } {
  const kinds = FACTORY_KINDS.filter((k) => args.counts[k] > 0);
  const total = kinds.reduce((sum, k) => sum + args.counts[k], 0);

  const system = [
    "You plan marketing campaigns for one small business. A plan is a table of",
    "distinct pieces, each built on its own idea, in the brand's real voice.",
    "",
    buildBrandVoiceBlock(args.brand, args.primaryIcp),
    "",
    buildPositioningBlock(args.brand),
    "",
    buildGuidelinesBlock(args.brand),
    "",
    "PRODUCTS AND SERVICES (slug: name):",
    ...buildProductLines(args.products),
    ...(args.memories.length ? ["", buildMemoryBlock(args.memories)] : []),
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const user = [
    `The owner wants a campaign about: "${args.sentence}"`,
    "",
    ...(args.research
      ? researchLines(args.research)
      : [
          "No research for this one: plan from the owner's words and the brand info alone.",
          "REAL FACTS ABOUT THIS BUSINESS: only what the owner said above and the brand info. Flag needs_detail wherever proof would help.",
        ]),
    "",
    `PLAN EXACTLY ${total} PIECES: ${kinds.map((k) => `${args.counts[k]} ${k}`).join(", ")}.`,
    "",
    "FORMATS (use only these ids, each with its own kind):",
    ...formatLines(kinds),
    "",
    "RULES",
    "- Every piece is a different idea. No two pieces share a hook, an opening word pattern, or a core idea. Rotate formats within each kind.",
    "- Hooks are concrete and specific to this business: a real detail, a number from the facts, a named situation the reader recognizes. Never generic openers like 'Unlock', 'Elevate', 'In today's world', 'Ever wondered', or 'Look no further'.",
    ...(args.research
      ? ["- Build on the research: use the hook patterns and trends where they fit, and set inspired_by to the source URL that sparked the piece."]
      : []),
    "- State as true only the REAL FACTS above and the brand info. Never invent numbers, results, testimonials, client names, prices, or deadlines. When a piece would be stronger with proof that isn't there, set needs_detail true and write detail_prompt as the one question to ask the owner.",
    "- Social and ad visuals show the real product or work when there is one, in a setting that fits the brand. No stock-photo cliches (handshakes, people pointing at laptops, lightbulbs).",
    "- When a visual shows off a designed item the business makes or sells (a sign, card, banner, packaging, a screen), say what sample design is on it (e.g. 'a yard sign for a fictional roofing company'), so it isn't shown blank.",
    ...(kinds.some((k) => k === "social" || k === "ad")
      ? [`- Set flyer_style to the one design direction all posts and ads share: ${FLYER_STYLE_CATALOG.map((s) => `${s.id} (${s.description})`).join("; ")}`]
      : []),
    "- Plain words, short sentences, the brand's voice. Never use em dashes.",
    "",
    "Call save_campaign_plan once with all the items.",
  ].join("\n");

  return { system, user };
}
