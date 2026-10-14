import type { Anthropic } from "@anthropic-ai/sdk";
import type {
  Brand,
  BrandMemory,
  FactoryFinding,
  FactoryKind,
  FactoryResearch,
  Icp,
  Product,
} from "@/lib/db/types";
import {
  buildBrandVoiceBlock,
  buildMemoryBlock,
  buildPositioningBlock,
  buildProductLines,
} from "./brand-voice";
import { FACTORY_KIND_LABELS } from "./campaign-formats";
import { stripEmDashes } from "@/lib/text";

// Stage 1 of the campaign factory (the content-factory skill's "Research and
// brief"): Claude searches the web for what's working in this niche right now
// and reads the business's own site for real facts, then saves a short,
// cited brief. The plan step builds every piece on top of it.

/** Search budget per campaign. Each search is $0.01 on top of tokens. */
export const RESEARCH_MAX_SEARCHES = 5;
export const RESEARCH_MAX_FETCHES = 3;

export const RESEARCH_TOOLS: Anthropic.ToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: RESEARCH_MAX_SEARCHES },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: RESEARCH_MAX_FETCHES },
];

const FINDING_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      point: { type: "string", description: "One specific finding, one or two sentences." },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "URLs this came from. Only URLs you actually searched or fetched.",
      },
    },
    required: ["point", "sources"],
  },
} as const;

export const SAVE_RESEARCH_TOOL: Anthropic.Tool = {
  name: "save_research",
  description:
    "Save the campaign research brief. Call exactly once, after researching.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Two or three sentences: the opportunity this campaign should take.",
      },
      trends: {
        ...FINDING_SCHEMA,
        description: "3 to 5 things working right now in this niche on social, ads, or email.",
      },
      competitor_patterns: {
        ...FINDING_SCHEMA,
        description: "2 to 4 patterns in what competitors are advertising or posting.",
      },
      hook_patterns: {
        type: "array",
        items: { type: "string" },
        description:
          "4 to 6 opening-line patterns that stop the scroll in this niche, written as templates.",
      },
      brand_facts: {
        ...FINDING_SCHEMA,
        description:
          "Real, checkable facts about THIS business from its own site or the brand info: services, prices, guarantees, results, locations. Never guesses.",
      },
    },
    required: ["summary", "trends", "competitor_patterns", "hook_patterns", "brand_facts"],
  },
};

export function buildResearchMessages(args: {
  brand: Brand;
  primaryIcp: Icp | null;
  products: Product[];
  memories: BrandMemory[];
  sentence: string;
  kinds: FactoryKind[];
  today: string;
}): { system: string; user: string } {
  const { brand } = args;
  const website = brand.visual_identity?.footer?.website?.trim();
  const system = [
    "You research marketing campaigns for one small business. You find what is",
    "working right now and the real facts a writer can use, and you cite every",
    "point. You never invent facts about the business.",
    "",
    buildBrandVoiceBlock(brand, args.primaryIcp),
    "",
    buildPositioningBlock(brand),
    "",
    "PRODUCTS AND SERVICES:",
    ...buildProductLines(args.products),
    ...(args.memories.length ? ["", buildMemoryBlock(args.memories)] : []),
  ].join("\n");

  const user = [
    `Today is ${args.today}.`,
    `The owner wants a campaign about: "${args.sentence}"`,
    `It will include: ${args.kinds.map((k) => FACTORY_KIND_LABELS[k].toLowerCase()).join(", ")}.`,
    website ? `The business website: ${website}` : "The business has no website on file.",
    "",
    "Research steps:",
    website
      ? "1. Fetch the business website (and at most one or two of its pages) for real facts: services, prices, guarantees, results, named work, locations."
      : "1. Use only the brand info above for facts about the business.",
    `2. Search the web (at most ${RESEARCH_MAX_SEARCHES} searches) for what is working right now in this niche: recent angles, hooks, and formats on Instagram, Facebook, TikTok, and email, and what competitors are advertising. Prefer specific, recent sources over generic marketing blogs.`,
    "3. Call save_research once.",
    "",
    "Rules: every finding cites the URLs it came from. Never cite a URL you did not get from a search or fetch. Facts about this business come only from its own site or the brand info, never from guesses or other businesses. Never use em dashes.",
  ].join("\n");

  return { system, user };
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? stripEmDashes(value).trim().slice(0, max) : "";
}

/** Same host, ignoring "www.", so the brand's own pages always count as sources. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Validates the save_research input. A source survives only when the search
 * or fetch actually returned it, or it's on the brand's own site, so a
 * hallucinated link can never reach the plan table. Findings that lose all
 * their sources are dropped, except brand facts, which may rest on the brand
 * info itself.
 */
export function parseResearch(
  input: unknown,
  opts: { knownSources: { url: string; title: string }[]; brandWebsite?: string },
): FactoryResearch {
  const raw = (input ?? {}) as Record<string, unknown>;
  const known = new Map(opts.knownSources.map((s) => [s.url, s.title]));
  const brandHost = opts.brandWebsite ? hostOf(opts.brandWebsite) : null;
  const used = new Map<string, string>();

  const keepUrl = (url: unknown): string | null => {
    if (typeof url !== "string") return null;
    const u = url.trim();
    if (known.has(u)) {
      used.set(u, known.get(u) || u);
      return u;
    }
    if (brandHost && hostOf(u) === brandHost) {
      used.set(u, u);
      return u;
    }
    return null;
  };

  const findings = (value: unknown, allowUnsourced: boolean): FactoryFinding[] =>
    (Array.isArray(value) ? value : [])
      .map((f) => {
        const item = (f ?? {}) as { point?: unknown; sources?: unknown };
        const point = cleanText(item.point, 400);
        const sources = (Array.isArray(item.sources) ? item.sources : [])
          .map(keepUrl)
          .filter((u): u is string => Boolean(u));
        return { point, sources };
      })
      .filter((f) => f.point && (allowUnsourced || f.sources.length > 0))
      .slice(0, 6);

  return {
    summary: cleanText(raw.summary, 600),
    trends: findings(raw.trends, false),
    competitor_patterns: findings(raw.competitor_patterns, false),
    hook_patterns: (Array.isArray(raw.hook_patterns) ? raw.hook_patterns : [])
      .map((h) => cleanText(h, 200))
      .filter(Boolean)
      .slice(0, 6),
    brand_facts: findings(raw.brand_facts, true),
    sources: [...used].map(([url, title]) => ({ url, title })),
  };
}
