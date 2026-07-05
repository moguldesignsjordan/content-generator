import { describe, expect, it } from "vitest";
import {
  BLOG_LENGTH_TARGETS,
  countBlogWords,
  resolveBlogType,
} from "./generate-blog";

// resolveBlogType reads only these four fields, so tests pass the minimal shape.
type BlogTypeInput = Parameters<typeof resolveBlogType>[0];

function makeTopic(overrides: Partial<BlogTypeInput> = {}): BlogTypeInput {
  return {
    title: "Brand strategy vs brand identity",
    intent: "informational",
    funnel_stage: "consideration",
    maps_to_product: null,
    ...overrides,
  };
}

describe("resolveBlogType", () => {
  it("classifies a 'How to' title as how_to", () => {
    expect(
      resolveBlogType(
        makeTopic({ title: "How to Write a Brand Positioning Statement" }),
      ),
    ).toBe("how_to");
  });

  it("classifies an 'N things' title as listicle", () => {
    expect(
      resolveBlogType(
        makeTopic({ title: "7 Signs Your Startup Has Outgrown Its Brand" }),
      ),
    ).toBe("listicle");
  });

  it("classifies a case study as case_study", () => {
    expect(
      resolveBlogType(
        makeTopic({ title: "Case Study: Rebranding a Seed-Stage SaaS" }),
      ),
    ).toBe("case_study");
  });

  it("defaults a generic informational title to pillar", () => {
    expect(
      resolveBlogType(
        makeTopic({ title: "Brand Strategy vs Brand Identity: What's the Difference?" }),
      ),
    ).toBe("pillar");
  });

  it("classifies a commercial-intent mapped offer as landing", () => {
    expect(
      resolveBlogType(
        makeTopic({
          title: "Brand Identity Package",
          intent: "commercial",
          maps_to_product: "brand-identity",
        }),
      ),
    ).toBe("landing");
  });

  it("classifies a brand-stage topic as thought_leadership", () => {
    expect(
      resolveBlogType(
        makeTopic({ title: "Why We Stopped Selling Logos", funnel_stage: "brand" }),
      ),
    ).toBe("thought_leadership");
  });
});

describe("countBlogWords", () => {
  it("sums intro + section bodies + conclusion", () => {
    const words = countBlogWords({
      intro: "One two three.",
      sections: [{ body: "Four five." }, { body: "Six seven eight." }],
      conclusion: "Nine ten.",
    });
    expect(words).toBe(10);
  });
});

describe("BLOG_LENGTH_TARGETS", () => {
  const types = [
    "pillar",
    "how_to",
    "listicle",
    "case_study",
    "thought_leadership",
    "landing",
  ] as const;

  it("has a sane, ordered target for every blog type", () => {
    for (const t of types) {
      const target = BLOG_LENGTH_TARGETS[t];
      expect(target.words[0]).toBeGreaterThan(0);
      expect(target.words[0]).toBeLessThan(target.words[1]);
      expect(target.sections[0]).toBeLessThanOrEqual(target.sections[1]);
      expect(target.directive.length).toBeGreaterThan(0);
    }
  });

  it("makes pillars longer than thought-leadership pieces", () => {
    expect(BLOG_LENGTH_TARGETS.pillar.words[0]).toBeGreaterThan(
      BLOG_LENGTH_TARGETS.thought_leadership.words[1],
    );
  });
});
