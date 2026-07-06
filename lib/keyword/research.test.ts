import { describe, expect, it } from "vitest";
import { normalizeKeywordData } from "./normalize";

// Captured sample shapes from the live DataForSEO endpoints (2026-07), not
// live calls: keywords_data/google_ads/search_volume returns a flat
// per-keyword result[]; the dataforseo_labs/* endpoints nest theirs one level
// deeper as result[0].items[].

describe("normalizeKeywordData", () => {
  it("builds primary + secondary from a full set of responses", () => {
    const data = normalizeKeywordData({
      keyword: "cold email tips",
      volume: {
        keyword: "cold email tips",
        search_volume: 1300,
        competition: "LOW",
        cpc: 2.5,
      },
      difficulty: { keyword: "cold email tips", keyword_difficulty: 34 },
      intent: {
        keyword: "cold email tips",
        keyword_intent: { label: "informational", probability: 0.92 },
      },
      related: [
        {
          keyword_data: {
            keyword: "cold email templates",
            keyword_info: {
              search_volume: 880,
              cpc: 3.1,
              competition_level: "MEDIUM",
              keyword_difficulty: 41,
            },
          },
        },
        {
          keyword_data: {
            keyword: "cold email subject lines",
            keyword_info: {
              search_volume: 590,
              cpc: 1.8,
              competition_level: "LOW",
              keyword_difficulty: 28,
            },
          },
        },
      ],
      geography: "US",
      languageCode: "en",
    });

    expect(data.primary).toEqual({
      keyword: "cold email tips",
      search_volume: 1300,
      difficulty: 34,
      intent: "informational",
      cpc: 2.5,
      competition: "LOW",
    });
    expect(data.secondary).toHaveLength(2);
    expect(data.secondary?.[0]).toEqual({
      keyword: "cold email templates",
      search_volume: 880,
      difficulty: 41,
      intent: null,
      cpc: 3.1,
      competition: "MEDIUM",
    });
    expect(data.location).toBe("US");
    expect(data.language).toBe("en");
    expect(data.source).toBe("dataforseo");
    expect(typeof data.researched_at).toBe("string");
  });

  it("degrades individual null pieces instead of failing", () => {
    const data = normalizeKeywordData({
      keyword: "b2b newsletter ideas",
      volume: {
        keyword: "b2b newsletter ideas",
        search_volume: 210,
        competition: null,
        cpc: null,
      },
      difficulty: null,
      intent: null,
      related: [],
      languageCode: "en",
    });

    expect(data.primary).toEqual({
      keyword: "b2b newsletter ideas",
      search_volume: 210,
      difficulty: null,
      intent: null,
      cpc: null,
      competition: null,
    });
    expect(data.secondary).toEqual([]);
  });

  it("drops a related keyword identical to the primary and caps secondary at 4", () => {
    const related = ["a", "b", "c", "d", "e"].map((k) => ({
      keyword_data: {
        keyword: k === "a" ? "seed keyword" : `seed keyword ${k}`,
        keyword_info: {
          search_volume: 100,
          cpc: 1,
          competition_level: "LOW",
          keyword_difficulty: 10,
        },
      },
    }));

    const data = normalizeKeywordData({
      keyword: "seed keyword",
      volume: null,
      difficulty: null,
      intent: null,
      related,
      languageCode: "en",
    });

    expect(data.secondary).toHaveLength(4);
    expect(data.secondary?.every((s) => s.keyword !== "seed keyword")).toBe(true);
  });

  it("throws when every endpoint came back empty", () => {
    expect(() =>
      normalizeKeywordData({
        keyword: "no data keyword",
        volume: null,
        difficulty: null,
        intent: null,
        related: [],
        languageCode: "en",
      }),
    ).toThrow();
  });
});
