import { describe, expect, it } from "vitest";
import type {
  CampaignBrief,
  Product,
  Topic,
  TopicStatus,
} from "@/lib/db/types";
import {
  EMAIL_LENGTH_TARGETS,
  countEmailWords,
  resolveEmailType,
} from "./generate-email";

// Minimal topic factory: only the fields resolveEmailType reads (funnel_stage,
// maps_to_product) vary per test; the rest are filled to satisfy the type.
function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: "t1",
    cluster_id: "c1",
    title: "How to write a positioning statement",
    target_keyword: "brand positioning",
    intent: "informational",
    funnel_stage: "awareness",
    internal_link_targets: [],
    maps_to_product: null,
    distribution_recipe: ["newsletter_tip"],
    status: "idea" as TopicStatus,
    published_url: null,
    archived: false,
    created_at: "2026-07-05T00:00:00Z",
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    brand_id: "b1",
    slug: "brand-audit",
    name: "Brand audit",
    description: "A full audit of your brand.",
    deliverables: [],
    price_point: null,
    url: null,
    created_at: "2026-07-05T00:00:00Z",
    ...overrides,
  };
}

describe("resolveEmailType", () => {
  it("defaults to newsletter for a plain awareness topic with no offer", () => {
    expect(resolveEmailType(makeTopic())).toBe("newsletter");
  });

  it("classifies a brand-stage topic as announcement", () => {
    expect(resolveEmailType(makeTopic({ funnel_stage: "brand" }))).toBe(
      "announcement",
    );
  });

  it("classifies a mapped service offer as service (keyword heuristic)", () => {
    const topic = makeTopic({ maps_to_product: "brand-audit" });
    const product = makeProduct({ name: "Brand Audit", description: "audit" });
    expect(resolveEmailType(topic, { product })).toBe("service");
  });

  it("classifies a mapped non-service offer as product", () => {
    const topic = makeTopic({
      maps_to_product: "templates-pack",
      funnel_stage: "decision",
    });
    const product = makeProduct({
      slug: "templates-pack",
      name: "Notion Templates Pack",
      description: "A pack of 40 templates.",
    });
    expect(resolveEmailType(topic, { product })).toBe("product");
  });

  it("falls back to product when the slug has no resolved product row", () => {
    const topic = makeTopic({ maps_to_product: "ghost-slug" });
    expect(resolveEmailType(topic, { product: null })).toBe("product");
  });

  it("classifies an offer-driven campaign with a promo angle as promotional", () => {
    const brief: CampaignBrief = {
      offer_slug: "rebrand-sprint",
      goal: "Drive signups for our rebrand launch",
      angle: "Limited spots for the launch cohort",
    };
    expect(resolveEmailType(makeTopic(), { brief })).toBe("promotional");
  });

  it("does not call a non-promo campaign promotional even with an offer_slug", () => {
    const brief: CampaignBrief = {
      offer_slug: "brand-audit",
      goal: "Explain how we run audits",
      angle: "Educational walkthrough",
    };
    expect(resolveEmailType(makeTopic(), { brief })).toBe("newsletter");
  });
});

describe("countEmailWords", () => {
  it("sums words across body sections only", () => {
    const words = countEmailWords({
      body_sections: [
        { body: "One two three four five." },
        { body: "Six seven eight." },
      ],
    });
    expect(words).toBe(8);
  });

  it("collapses internal whitespace and ignores empty sections", () => {
    const words = countEmailWords({
      body_sections: [{ body: "  leading   gap   here  " }, { body: "   " }],
    });
    expect(words).toBe(3);
  });
});

describe("EMAIL_LENGTH_TARGETS", () => {
  const types = ["newsletter", "product", "service", "promotional", "announcement"] as const;

  it("has a sane, ordered target for every email type", () => {
    for (const t of types) {
      const target = EMAIL_LENGTH_TARGETS[t];
      expect(target.words[0]).toBeGreaterThan(0);
      expect(target.words[0]).toBeLessThan(target.words[1]);
      expect(target.sections[0]).toBeLessThanOrEqual(target.sections[1]);
      expect(target.directive.length).toBeGreaterThan(0);
    }
  });

  it("makes newsletters longer than promotional emails", () => {
    expect(EMAIL_LENGTH_TARGETS.newsletter.words[0]).toBeGreaterThan(
      EMAIL_LENGTH_TARGETS.promotional.words[1],
    );
  });
});
