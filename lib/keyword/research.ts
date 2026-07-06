import "server-only";
import { postTasks, type DataForSeoTask } from "@/lib/clients/dataforseo";
import type { KeywordData, SeoDefaults } from "@/lib/db/types";
import {
  normalizeKeywordData,
  type DifficultyItem,
  type IntentItem,
  type RelatedItem,
  type SearchVolumeItem,
} from "./normalize";

// Slice 4 "enrich" cut: validates ONE keyword a topic already carries against
// real DataForSEO numbers (volume/difficulty/intent/cpc) and surfaces a
// handful of related keywords as secondary suggestions. Cluster discovery and
// SERP analysis are deliberately out of scope (see the plan doc).
//
// Four Live calls per research action (interactive single-item, so Live's
// synchronous request is worth the few-cents premium over the Standard
// queue): google_ads/search_volume (primary volume/cpc/competition),
// bulk_keyword_difficulty (primary difficulty), search_intent (primary
// intent), related_keywords (secondary suggestions, each already carrying its
// own volume/difficulty so no extra calls are needed for them). Any one call
// failing degrades that piece to null rather than failing the whole request;
// all four failing throws (see normalizeKeywordData in ./normalize).

// Common geography inputs (brands.seo_defaults.geography is free text, e.g.
// "US" from the seed). Anything not in this map is passed through as
// location_name, which DataForSEO also accepts (e.g. "United States").
const LOCATION_CODES: Record<string, number> = {
  us: 2840,
  usa: 2840,
  "united states": 2840,
  uk: 2826,
  gb: 2826,
  "united kingdom": 2826,
  ca: 2124,
  canada: 2124,
  au: 2036,
  australia: 2036,
};

function resolveLocation(geography?: string): { location_code?: number; location_name?: string } {
  const key = (geography ?? "US").trim().toLowerCase();
  const code = LOCATION_CODES[key];
  return code ? { location_code: code } : { location_name: geography };
}

function resolveLanguageCode(language?: string): string {
  const value = (language ?? "en").trim().toLowerCase();
  return /^[a-z]{2}$/.test(value) ? value : "en";
}

/** The wrapper object a Labs endpoint's result[] array holds (result[0].items[]). */
interface LabsResult<T> {
  items?: T[];
}

/** Labs endpoints (dataforseo_labs/*) nest their payload as result[0].items[]. */
function firstLabsItems<T>(tasks: DataForSeoTask<LabsResult<T>>[] | null): T[] {
  return tasks?.[0]?.result?.[0]?.items ?? [];
}

/** Plain keywords_data endpoints return result[] as a flat per-keyword array. */
function flatResult<T>(tasks: DataForSeoTask<T>[] | null): T[] {
  return tasks?.[0]?.result ?? [];
}

/**
 * Validates `keyword` against real DataForSEO numbers. Throws if DataForSEO
 * isn't configured (caller should check isDataForSeoConfigured() first for a
 * clean UI message) or if every endpoint call fails.
 */
export async function researchKeyword(
  keyword: string,
  seoDefaults: SeoDefaults,
): Promise<KeywordData> {
  const location = resolveLocation(seoDefaults.geography);
  const language_code = resolveLanguageCode(seoDefaults.language);

  const [volumeRes, difficultyRes, intentRes, relatedRes] = await Promise.allSettled([
    postTasks<SearchVolumeItem>("keywords_data/google_ads/search_volume/live", [
      { keywords: [keyword], ...location, language_code },
    ]),
    postTasks<LabsResult<DifficultyItem>>(
      "dataforseo_labs/google/bulk_keyword_difficulty/live",
      [{ keywords: [keyword], ...location, language_code }],
    ),
    postTasks<LabsResult<IntentItem>>("dataforseo_labs/google/search_intent/live", [
      { keywords: [keyword], language_code },
    ]),
    postTasks<LabsResult<RelatedItem>>("dataforseo_labs/google/related_keywords/live", [
      { keyword, ...location, language_code, depth: 1, limit: 10 },
    ]),
  ]);

  if (
    volumeRes.status === "rejected" &&
    difficultyRes.status === "rejected" &&
    intentRes.status === "rejected" &&
    relatedRes.status === "rejected"
  ) {
    throw new Error(
      `DataForSEO research failed: ${(volumeRes.reason as Error)?.message ?? "unknown error"}`,
    );
  }

  return normalizeKeywordData({
    keyword,
    volume: volumeRes.status === "fulfilled" ? flatResult(volumeRes.value.tasks)[0] ?? null : null,
    difficulty:
      difficultyRes.status === "fulfilled"
        ? firstLabsItems(difficultyRes.value.tasks)[0] ?? null
        : null,
    intent: intentRes.status === "fulfilled" ? firstLabsItems(intentRes.value.tasks)[0] ?? null : null,
    related: relatedRes.status === "fulfilled" ? firstLabsItems(relatedRes.value.tasks) : [],
    geography: seoDefaults.geography,
    languageCode: language_code,
  });
}
