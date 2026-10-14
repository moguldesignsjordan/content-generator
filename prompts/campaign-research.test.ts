import { describe, expect, it } from "vitest";
import type { Anthropic } from "@anthropic-ai/sdk";
import { parseResearch } from "./campaign-research";
import { collectSources } from "@/lib/pipeline/campaign-factory";

// Built at runtime so this file never contains the banned character itself.
const EM_DASH = String.fromCharCode(0x2014);

const known = [
  { url: "https://trends.example.com/a", title: "Trend A" },
  { url: "https://rival.example.com/ads", title: "Rival ads" },
];

describe("parseResearch", () => {
  it("drops URLs the search never returned, and findings left with no source", () => {
    const out = parseResearch(
      {
        summary: "Go short.",
        trends: [
          { point: "Real one", sources: ["https://trends.example.com/a"] },
          { point: "Made up", sources: ["https://invented.example.com"] },
        ],
        competitor_patterns: [],
        hook_patterns: ["Stop doing X"],
        brand_facts: [],
      },
      { knownSources: known },
    );
    expect(out.trends).toEqual([{ point: "Real one", sources: ["https://trends.example.com/a"] }]);
    expect(out.sources).toEqual([{ url: "https://trends.example.com/a", title: "Trend A" }]);
  });

  it("accepts the brand's own pages and keeps unsourced brand facts", () => {
    const out = parseResearch(
      {
        brand_facts: [
          { point: "Plans start at $49", sources: ["https://www.mogul.example/pricing"] },
          { point: "Based in Miami", sources: [] },
        ],
      },
      { knownSources: [], brandWebsite: "https://mogul.example" },
    );
    expect(out.brand_facts).toHaveLength(2);
    expect(out.brand_facts[0].sources).toEqual(["https://www.mogul.example/pricing"]);
  });

  it("survives a malformed tool input", () => {
    const out = parseResearch(null, { knownSources: [] });
    expect(out.summary).toBe("");
    expect(out.trends).toEqual([]);
  });

  it("strips em dashes from findings", () => {
    const out = parseResearch(
      { hook_patterns: [`Short ${EM_DASH} sharp`] },
      { knownSources: [] },
    );
    expect(out.hook_patterns[0]).not.toContain(EM_DASH);
  });
});

describe("collectSources", () => {
  it("reads search results, fetches, citations, and code output, skipping search errors", () => {
    const content = [
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url: "https://a.example", title: "A" }],
      },
      { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
      {
        type: "web_fetch_tool_result",
        content: { type: "web_fetch_result", url: "https://b.example", content: { title: "B" } },
      },
      { type: "text", text: "x", citations: [{ url: "https://c.example", title: "C" }] },
      { type: "bash_code_execution_tool_result", content: { stdout: "see https://d.example/page) now" } },
    ] as unknown as Anthropic.ContentBlock[];
    expect(collectSources(content).map((s) => s.url)).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
      "https://d.example/page",
    ]);
  });
});
