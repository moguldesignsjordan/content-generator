import type { Anthropic } from "@anthropic-ai/sdk";
import { MAIN_ACTION_KINDS, type OnboardingInput } from "@/lib/db/types";
import type { BusinessResearch } from "@/lib/onboarding/proposal";
import { formatPhone } from "@/lib/scrape/phones";
import { stripEmDashes } from "@/lib/text";

// Onboarding's web research: one Sonnet turn searches for the business's
// reviews, listings, and nearby competitors, then saves what it found with a
// source on every item. parseBusinessResearch drops anything not backed by a
// URL the tools actually returned (or the business's own site), the same
// contract as prompts/campaign-research.ts.

export const BUSINESS_MAX_SEARCHES = 4;
export const BUSINESS_MAX_FETCHES = 2;

export const BUSINESS_RESEARCH_TOOLS: Anthropic.ToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: BUSINESS_MAX_SEARCHES },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: BUSINESS_MAX_FETCHES },
];

const SOURCED_FACT = {
  type: "object",
  properties: {
    value: { type: "string" },
    source: { type: "string", description: "The URL it came from. Only a URL you searched or fetched." },
  },
  required: ["value", "source"],
} as const;

const SOURCED_LIST = {
  type: "array",
  items: {
    type: "object",
    properties: {
      point: { type: "string", description: "A short phrase, a few words." },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "URLs it came from. Only URLs you searched or fetched.",
      },
    },
    required: ["point", "sources"],
  },
} as const;

export const SAVE_BUSINESS_RESEARCH_TOOL: Anthropic.Tool = {
  name: "save_business_research",
  description:
    "Save what you found about this business. Call exactly once. Leave out anything you couldn't find or couldn't tie to this exact business.",
  input_schema: {
    type: "object",
    properties: {
      name: { ...SOURCED_FACT, description: "The business's name as its listings write it." },
      website: { ...SOURCED_FACT, description: "Its own website, when it has one." },
      phone: { ...SOURCED_FACT, description: "Its customer phone number, as listed." },
      postal_address: { ...SOURCED_FACT, description: "Its street address, as listed." },
      service_area: { ...SOURCED_FACT, description: "Where it serves customers, a few words." },
      rating: {
        ...SOURCED_FACT,
        description: 'Its review rating in words, e.g. "4.8 stars from 120 Google reviews".',
      },
      guarantee: { ...SOURCED_FACT, description: "A guarantee or warranty it states." },
      main_action: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...MAIN_ACTION_KINDS] },
          wording: {
            type: "string",
            description: 'What the customer gets, completing "Call us for ...", e.g. "a free estimate".',
          },
          source: { type: "string" },
        },
        required: ["kind", "source"],
        description: "How customers mostly reach it (call, book, visit, order, quote, message).",
      },
      praise: { ...SOURCED_LIST, description: "2 to 5 things reviewers praise most, as short phrases." },
      pains: { ...SOURCED_LIST, description: "2 to 4 problems customers came to it with." },
      customer_words: {
        ...SOURCED_LIST,
        description: "3 to 6 words or phrases customers use in reviews for what they needed.",
      },
      objections: { ...SOURCED_LIST, description: "1 to 3 worries or complaints that come up." },
      competitors: { ...SOURCED_LIST, description: "Up to 4 nearby competitors, by name." },
    },
  },
};

/** Builds the (system, user) pair for the research turn. */
export function buildBusinessResearchMessages(input: OnboardingInput): {
  system: string;
  user: string;
} {
  const system = [
    "You look up one small business on the web so its owner doesn't have to",
    "type it all in. You find its listings, what reviewers say, and who it",
    "competes with nearby, and you cite every item. You never guess.",
  ].join("\n");

  const who = [
    input.url ? `Website: ${input.url}` : "",
    input.name ? `Name: ${input.name}` : "",
    input.description ? `What they do, in the owner's words: ${input.description}` : "",
    input.city ? `City: ${input.city}` : "",
  ].filter(Boolean);

  const user = [
    "THE BUSINESS:",
    ...who.map((l) => `  ${l}`),
    "",
    "Steps:",
    `1. Search (at most ${BUSINESS_MAX_SEARCHES} searches) for its reviews and listings: Google, Yelp, Facebook, the BBB, and directories for its trade.${input.url ? "" : " Find its own website if it has one."}`,
    `2. Fetch (at most ${BUSINESS_MAX_FETCHES}) a listing or review page when the search snippets aren't enough. Review sites often block fetching; move on when one does.`,
    "3. Call save_business_research once.",
    "",
    "Rules:",
    "- Only use results that are clearly THIS business: the same name and the same city or website. Many businesses share a name; when unsure, leave it out.",
    "- Every item carries the URL it came from, one you actually searched or fetched.",
    "- Praise, pains, customer words, and objections come from what customers wrote, in short plain phrases.",
    "- Never use em dashes.",
  ].join("\n");

  return { system, user };
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

const MAX_FACT = 200;
const MAX_POINT = 120;

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? stripEmDashes(value).trim().slice(0, max) : "";
}

/**
 * Validates the save_business_research input. An item survives only when a
 * source it cites was actually returned by the search or fetch, or is on the
 * business's own site; everything else is dropped, so a hallucinated listing
 * never reaches the owner's snapshot.
 */
export function parseBusinessResearch(
  input: unknown,
  opts: { knownSources: { url: string; title: string }[]; website?: string },
): BusinessResearch {
  const raw = (input ?? {}) as Record<string, unknown>;
  const known = new Map(opts.knownSources.map((s) => [s.url, s.title]));
  const used = new Map<string, string>();

  // The business's own site counts as a source, whether the owner gave it or
  // the research found it on a sourced listing.
  const rawSite = raw.website as { value?: unknown; source?: unknown } | undefined;
  const siteFromListing =
    typeof rawSite?.source === "string" && known.has(rawSite.source.trim())
      ? cleanText(rawSite.value, MAX_FACT)
      : "";
  const website = opts.website || siteFromListing || undefined;
  const ownHost = website ? hostOf(website) : null;

  const keepUrl = (url: unknown): string | null => {
    if (typeof url !== "string") return null;
    const u = url.trim();
    if (known.has(u)) {
      used.set(u, known.get(u) || u);
      return u;
    }
    if (ownHost && hostOf(u) === ownHost) {
      used.set(u, u);
      return u;
    }
    return null;
  };

  if (siteFromListing) keepUrl(rawSite?.source);

  const fact = (key: string): string | undefined => {
    const item = raw[key] as { value?: unknown; source?: unknown } | undefined;
    const value = cleanText(item?.value, MAX_FACT);
    return value && keepUrl(item?.source) ? value : undefined;
  };

  const list = (key: string, max: number): string[] => {
    const seen = new Set<string>();
    return (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [])
      .map((entry) => {
        const item = (entry ?? {}) as { point?: unknown; sources?: unknown };
        const point = cleanText(item.point, MAX_POINT);
        const sourced = (Array.isArray(item.sources) ? item.sources : []).filter(
          (s) => keepUrl(s) !== null,
        );
        return sourced.length ? point : "";
      })
      .filter((p) => {
        const key = p.toLowerCase();
        if (!p || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, max);
  };

  const action = raw.main_action as { kind?: unknown; wording?: unknown; source?: unknown } | undefined;
  const kind = MAIN_ACTION_KINDS.find((k) => k === action?.kind);
  const mainAction =
    kind && keepUrl(action?.source)
      ? { kind, wording: cleanText(action?.wording, MAX_FACT) || undefined }
      : undefined;

  const phone = fact("phone");
  const research: BusinessResearch = {
    name: fact("name"),
    website: siteFromListing || undefined,
    phone: phone ? formatPhone(phone) : undefined,
    postal_address: fact("postal_address"),
    service_area: fact("service_area"),
    rating: fact("rating"),
    guarantee: fact("guarantee"),
    main_action: mainAction,
    praise: list("praise", 5),
    pains: list("pains", 4),
    customer_words: list("customer_words", 6),
    objections: list("objections", 3),
    competitors: list("competitors", 4),
    sources: [],
  };
  research.sources = [...used].map(([url, title]) => ({ url, title }));
  return research;
}
