import { describe, expect, it } from "vitest";
import { buildKeywordLines } from "./brand-voice";

describe("buildKeywordLines", () => {
  it("falls back to the raw topic fields when the topic hasn't been researched", () => {
    expect(
      buildKeywordLines({
        target_keyword: "cold email tips",
        intent: "informational",
        keyword_data: {},
      }),
    ).toEqual([
      "TARGET KEYWORD: cold email tips",
      "SEARCH INTENT: informational",
    ]);
  });

  it("cites validated figures and secondary keywords once researched", () => {
    const lines = buildKeywordLines({
      target_keyword: "cold email tips",
      intent: "informational",
      keyword_data: {
        primary: {
          keyword: "cold email tips",
          search_volume: 1300,
          difficulty: 34,
          intent: "informational",
          cpc: 2.5,
          competition: "LOW",
        },
        secondary: [
          {
            keyword: "cold email templates",
            search_volume: 880,
            difficulty: 41,
            intent: null,
            cpc: 3.1,
            competition: "MEDIUM",
          },
        ],
      },
    });

    expect(lines[0]).toBe(
      "TARGET KEYWORD (DataForSEO-validated): cold email tips (~1300/mo searches, difficulty 34/100, informational intent)",
    );
    expect(lines[1]).toBe(
      "SECONDARY KEYWORDS (work in naturally where they fit): cold email templates (~880/mo)",
    );
  });

  it("omits the secondary line when there are no secondary keywords", () => {
    const lines = buildKeywordLines({
      target_keyword: "b2b newsletter ideas",
      intent: null,
      keyword_data: {
        primary: {
          keyword: "b2b newsletter ideas",
          search_volume: 210,
          difficulty: null,
          intent: null,
          cpc: null,
          competition: null,
        },
        secondary: [],
      },
    });

    expect(lines).toEqual([
      "TARGET KEYWORD (DataForSEO-validated): b2b newsletter ideas (~210/mo searches)",
    ]);
  });
});
