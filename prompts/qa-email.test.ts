import { describe, expect, it } from "vitest";
import { buildGroundingFactsBlock } from "./qa-email";
import { designQaIssues } from "@/lib/email/quality";
import type { Brand, TopicContext } from "@/lib/db/types";

function ctxWithGuarantee(guarantee?: string): TopicContext {
  return {
    brand: {
      visual_identity: guarantee ? { footer: { guarantee } } : {},
    } as Brand,
  } as TopicContext;
}

describe("buildGroundingFactsBlock", () => {
  it("treats a brand guarantee as a real fact the copy may state", () => {
    const block = buildGroundingFactsBlock(
      ctxWithGuarantee("Money-back guarantee on every print run."),
      null,
    );
    expect(block).toContain("GROUNDING FACTS");
    expect(block).toContain("Money-back guarantee on every print run.");
  });

  it("treats a factory piece's research facts as real, so QA won't strip them", () => {
    const block = buildGroundingFactsBlock(ctxWithGuarantee(), {
      research_notes: "Real facts about this business:\n- Plans start at $49 a month",
    });
    expect(block).not.toContain("none on file");
    expect(block).toContain("Plans start at $49 a month");
  });

  it("still reports no facts on file when no guarantee is set", () => {
    expect(buildGroundingFactsBlock(ctxWithGuarantee(), null)).toContain("none on file");
  });

  it("treats the brand's saved differentiators as real facts", () => {
    const ctx = {
      brand: {
        visual_identity: {},
        positioning: { differentiators: ["99+ Google PageSpeed Score", "0.5s average load time", " "] },
      } as Brand,
    } as TopicContext;
    const block = buildGroundingFactsBlock(ctx, null);
    expect(block).not.toContain("none on file");
    expect(block).toContain("99+ Google PageSpeed Score");
    expect(block).toContain("0.5s average load time");
    expect(block.match(/Brand differentiator:/g)).toHaveLength(2);
  });

  it("lists the saved phone, service area, and main action as real facts", () => {
    const ctx = {
      brand: {
        visual_identity: { footer: { phone: "(214) 555-0101" } },
        positioning: { service_area: "Dallas", main_action: "Call for a free inspection" },
      } as Brand,
    } as TopicContext;
    const block = buildGroundingFactsBlock(ctx, null);
    expect(block).toContain("Brand phone: (214) 555-0101");
    expect(block).toContain("Service area: Dallas");
    expect(block).toContain("Main call to action: Call for a free inspection");
  });
});

describe("designQaIssues", () => {
  it("keeps contrast findings, which a redesign can actually fix", () => {
    expect(
      designQaIssues({
        issues: [
          "Low contrast: text #ffffff on background #ff9d14 is 2.1:1 (needs 4.5:1).",
          'Unsupported specifics: "money-back guarantee on every print run"',
          "Length: 180 of 300 words. Too short.",
        ],
      }),
    ).toEqual([
      "Low contrast: text #ffffff on background #ff9d14 is 2.1:1 (needs 4.5:1).",
    ]);
  });

  it("returns nothing when QA found no design problems", () => {
    expect(designQaIssues({})).toEqual([]);
  });
});
