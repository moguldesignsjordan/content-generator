import type { KeywordData, KeywordMetric } from "@/lib/db/types";

// Pure normalizer, deliberately free of the "server-only" import chain (which
// Vitest's Vite resolver can't follow, unlike Next's webpack build) so it
// stays directly unit-testable. lib/keyword/research.ts (the DataForSEO
// orchestrator) is the only caller in production.

// ── Raw per-endpoint item shapes (only the fields we read) ──────────────────

export interface SearchVolumeItem {
  keyword: string;
  search_volume: number | null;
  competition: string | null;
  cpc: number | null;
}

export interface DifficultyItem {
  keyword: string;
  keyword_difficulty: number | null;
}

export interface IntentItem {
  keyword: string;
  keyword_intent: { label: string; probability: number } | null;
}

export interface RelatedItem {
  keyword_data: {
    keyword: string;
    keyword_info?: {
      search_volume: number | null;
      cpc: number | null;
      competition_level: string | null;
      keyword_difficulty: number | null;
    };
  };
}

export function normalizeKeywordData(input: {
  keyword: string;
  volume: SearchVolumeItem | null;
  difficulty: DifficultyItem | null;
  intent: IntentItem | null;
  related: RelatedItem[];
  geography?: string;
  languageCode: string;
}): KeywordData {
  const { keyword, volume, difficulty, intent, related, geography, languageCode } = input;

  if (!volume && !difficulty && !intent && related.length === 0) {
    throw new Error("DataForSEO returned no data for this keyword.");
  }

  const primary: KeywordMetric = {
    keyword,
    search_volume: volume?.search_volume ?? null,
    difficulty: difficulty?.keyword_difficulty ?? null,
    intent: intent?.keyword_intent?.label ?? null,
    cpc: volume?.cpc ?? null,
    competition: volume?.competition ?? null,
  };

  const secondary: KeywordMetric[] = related
    .filter((r) => r.keyword_data?.keyword && r.keyword_data.keyword !== keyword)
    .slice(0, 4)
    .map((r) => ({
      keyword: r.keyword_data.keyword,
      search_volume: r.keyword_data.keyword_info?.search_volume ?? null,
      difficulty: r.keyword_data.keyword_info?.keyword_difficulty ?? null,
      intent: null,
      cpc: r.keyword_data.keyword_info?.cpc ?? null,
      competition: r.keyword_data.keyword_info?.competition_level ?? null,
    }));

  return {
    primary,
    secondary,
    location: geography,
    language: languageCode,
    researched_at: new Date().toISOString(),
    source: "dataforseo",
  };
}
