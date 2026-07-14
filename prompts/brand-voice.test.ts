import { describe, expect, it } from "vitest";
import type { ReferenceEmail } from "@/lib/db/types";
import {
  buildCampaignBriefBlock,
  buildKeywordLines,
  buildReferenceEmailsBlock,
} from "./brand-voice";

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

function makeReference(overrides: Partial<ReferenceEmail> = {}): ReferenceEmail {
  return {
    id: "r1",
    brand_id: "b1",
    name: "April promo",
    content: "Hey there,\n\nShort and punchy body.\n\nJordan",
    style_profile: {
      summary: "Short, casual, first-person notes with one plain CTA.",
      traits: ["Open with a one-line hook", "Keep paragraphs to 1-2 sentences"],
      approx_words: 120,
    },
    created_at: "2026-07-13T00:00:00Z",
    ...overrides,
  };
}

describe("buildReferenceEmailsBlock", () => {
  it("returns an empty string when the library is empty or missing", () => {
    expect(buildReferenceEmailsBlock(undefined)).toBe("");
    expect(buildReferenceEmailsBlock([])).toBe("");
  });

  it("includes distilled traits and the raw email body", () => {
    const block = buildReferenceEmailsBlock([makeReference()]);
    expect(block).toContain("REFERENCE EMAILS");
    expect(block).toContain("Short, casual, first-person notes");
    expect(block).toContain("- Open with a one-line hook");
    expect(block).toContain("Short and punchy body.");
    expect(block).toContain("~120 words");
  });

  it("skips the traits section for a row whose extraction failed, but keeps its raw text", () => {
    const block = buildReferenceEmailsBlock([
      makeReference({ style_profile: null, content: "Raw only body text." }),
    ]);
    expect(block).toContain("Raw only body text.");
  });

  it("injects at most two full reference bodies", () => {
    const refs = [1, 2, 3].map((n) =>
      makeReference({ id: `r${n}`, name: `Ref ${n}`, content: `BODY_${n}` }),
    );
    const block = buildReferenceEmailsBlock(refs);
    expect(block).toContain("BODY_1");
    expect(block).toContain("BODY_2");
    expect(block).not.toContain("BODY_3");
  });

  it("truncates an oversized reference body", () => {
    const block = buildReferenceEmailsBlock([
      makeReference({ content: "x".repeat(5000) }),
    ]);
    expect(block).toContain("[truncated]");
    expect(block.length).toBeLessThan(5000);
  });
});

describe("buildCampaignBriefBlock style_example", () => {
  it("injects the per-piece style example with the match-style instruction", () => {
    const block = buildCampaignBriefBlock({
      goal: "Book calls",
      style_example: "Subject: hi\n\nA tiny example email.",
    });
    expect(block).toContain("STYLE EXAMPLE");
    expect(block).toContain("A tiny example email.");
    expect(block).toContain("NEVER");
  });

  it("omits the style section when no example was given", () => {
    expect(buildCampaignBriefBlock({ goal: "Book calls" })).not.toContain(
      "STYLE EXAMPLE",
    );
  });
});
