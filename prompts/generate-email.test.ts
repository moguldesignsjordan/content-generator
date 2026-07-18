import { describe, expect, it } from "vitest";
import type {
  Brand,
  CampaignBrief,
  EmailTemplateId,
  EmailType,
  FeedbackEmailExample,
  Product,
  Topic,
  TopicContext,
  TopicStatus,
} from "@/lib/db/types";
import {
  EMAIL_LENGTH_TARGETS,
  buildFeedbackBlock,
  buildOfferBlock,
  countEmailWords,
  resolveEmailLayout,
  resolveEmailTemplateId,
  resolveEmailType,
  resolveLengthTarget,
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
    keyword_data: {},
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
    image_url: null,
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

  it("classifies an offer with a real deadline as promotional even with no promo keyword", () => {
    const brief: CampaignBrief = {
      offer_slug: "brand-audit",
      goal: "Explain how we run audits",
      angle: "Educational walkthrough",
      offer_deadline: "ends Friday",
    };
    expect(resolveEmailType(makeTopic(), { brief })).toBe("promotional");
  });

  it("still requires an offer_slug; a deadline alone doesn't flip an unrelated topic", () => {
    const brief: CampaignBrief = { offer_deadline: "ends Friday" };
    expect(resolveEmailType(makeTopic(), { brief })).toBe("newsletter");
  });
});

describe("resolveEmailLayout", () => {
  const COMPATIBLE: Record<EmailType, EmailTemplateId[]> = {
    newsletter: ["newsletter_tip", "newsletter_feature", "newsletter_howto", "digest"],
    product: ["product_spotlight", "newsletter_feature"],
    service: ["product_spotlight", "newsletter_feature"],
    promotional: ["promotional_bold"],
    announcement: ["announcement_banner"],
  };

  it("maps every EmailType to a layout inside its compatible set", () => {
    for (const [type, compatible] of Object.entries(COMPATIBLE) as [
      EmailType,
      EmailTemplateId[],
    ][]) {
      for (let seedIndex = 0; seedIndex < 6; seedIndex++) {
        const layout = resolveEmailLayout(type, makeTopic({ distribution_recipe: [] }), {
          seedIndex,
        });
        expect(compatible).toContain(layout);
      }
    }
  });

  it("no longer forces newsletter_tip for every newsletter email (rotates the set)", () => {
    const picks = new Set(
      Array.from({ length: 4 }, (_, i) =>
        resolveEmailLayout("newsletter", makeTopic({ distribution_recipe: [] }), {
          seedIndex: i,
        }),
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("never repeats within a small recent-avoid window for a multi-option type", () => {
    for (let i = 0; i < 100; i++) {
      const layout = resolveEmailLayout("newsletter", makeTopic({ distribution_recipe: [] }), {
        recent: ["newsletter_tip", "newsletter_feature"],
      });
      expect(["newsletter_tip", "newsletter_feature"]).not.toContain(layout);
    }
  });

  it("still honors a known layout named in the topic's distribution recipe", () => {
    const topic = makeTopic({ distribution_recipe: ["digest"] });
    expect(resolveEmailLayout("newsletter", topic, { seedIndex: 0 })).toBe("digest");
    expect(resolveEmailLayout("promotional", topic, { seedIndex: 0 })).toBe("digest");
  });

  it("assigns distinct layouts by index within one email type's set", () => {
    const compatible = COMPATIBLE.newsletter;
    const picks = compatible.map((_, i) =>
      resolveEmailLayout("newsletter", makeTopic({ distribution_recipe: [] }), {
        seedIndex: i,
      }),
    );
    expect(new Set(picks).size).toBe(compatible.length);
  });
});

describe("resolveEmailTemplateId", () => {
  it("defaults to newsletter_tip with no recipe match", () => {
    expect(resolveEmailTemplateId(makeTopic({ distribution_recipe: [] }))).toBe(
      "newsletter_tip",
    );
  });

  it("honors any known layout id in the recipe, including the newer shapes", () => {
    expect(
      resolveEmailTemplateId(makeTopic({ distribution_recipe: ["promotional_bold"] })),
    ).toBe("promotional_bold");
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

describe("resolveLengthTarget", () => {
  const types = ["newsletter", "product", "service", "promotional", "announcement"] as const;

  it("returns the base target untouched for standard or unset preference", () => {
    expect(resolveLengthTarget("newsletter", undefined)).toEqual(
      EMAIL_LENGTH_TARGETS.newsletter,
    );
    expect(resolveLengthTarget("newsletter", "standard")).toEqual(
      EMAIL_LENGTH_TARGETS.newsletter,
    );
  });

  it("roughly halves the word budget for short, for every type, keeping order", () => {
    for (const t of types) {
      const base = EMAIL_LENGTH_TARGETS[t];
      const short = resolveLengthTarget(t, "short");
      expect(short.words[0]).toBeLessThan(base.words[0]);
      expect(short.words[1]).toBeLessThan(base.words[1]);
      expect(short.words[0]).toBeLessThan(short.words[1]);
      expect(short.sections[0]).toBeLessThanOrEqual(short.sections[1]);
    }
  });

  it("stretches the budget for long without shrinking sections", () => {
    for (const t of types) {
      const base = EMAIL_LENGTH_TARGETS[t];
      const long = resolveLengthTarget(t, "long");
      expect(long.words[0]).toBeGreaterThan(base.words[0]);
      expect(long.words[1]).toBeGreaterThan(base.words[1]);
      expect(long.sections).toEqual(base.sections);
    }
  });

  it("appends the preference to the directive so the model hears the why", () => {
    expect(resolveLengthTarget("newsletter", "short").directive).toContain("SHORT");
    expect(resolveLengthTarget("newsletter", "long").directive).toContain("LONGER");
  });

  it("never drops below the 50-word floor on the tightest type", () => {
    const short = resolveLengthTarget("promotional", "short");
    expect(short.words[0]).toBeGreaterThanOrEqual(50);
  });
});

describe("buildFeedbackBlock", () => {
  it("returns empty for no examples", () => {
    expect(buildFeedbackBlock(undefined)).toBe("");
    expect(buildFeedbackBlock([])).toBe("");
  });

  it("surfaces a disliked example's Why line when a note is given", () => {
    const examples: FeedbackEmailExample[] = [
      {
        feedback: "down",
        subject: "Big sale this week",
        email_type: "promotional",
        excerpt: "Buy now before it's gone.",
        note: "Too generic",
      },
    ];
    const block = buildFeedbackBlock(examples);
    expect(block).toContain("Why: Too generic");
    expect(block).toContain("Big sale this week");
  });

  it("omits the Why line when no note was given", () => {
    const examples: FeedbackEmailExample[] = [
      {
        feedback: "down",
        subject: "Big sale this week",
        email_type: "promotional",
        excerpt: "Buy now before it's gone.",
      },
    ];
    const block = buildFeedbackBlock(examples);
    expect(block).not.toContain("Why:");
  });

  it("separates liked and disliked sections", () => {
    const examples: FeedbackEmailExample[] = [
      { feedback: "up", subject: "Loved this one", email_type: "newsletter", excerpt: "" },
      { feedback: "down", subject: "Hated this one", email_type: "newsletter", excerpt: "" },
    ];
    const block = buildFeedbackBlock(examples);
    expect(block).toContain("Emails they LIKED");
    expect(block).toContain("Loved this one");
    expect(block).toContain("Emails they DISLIKED");
    expect(block).toContain("Hated this one");
  });
});

function makeCtx(topic: Topic, product: Product | null): TopicContext {
  return {
    topic,
    brand: {} as Brand,
    strategy: {} as TopicContext["strategy"],
    primaryIcp: null,
    product,
  };
}

describe("buildOfferBlock", () => {
  it("falls back to naming the slug when there's no product row and no brief offer", () => {
    const ctx = makeCtx(makeTopic({ maps_to_product: "ghost-slug" }), null);
    expect(buildOfferBlock(ctx)).toBe("RELATED OFFER: ghost-slug");
  });

  it("returns empty when there's nothing at all to offer", () => {
    const ctx = makeCtx(makeTopic({ maps_to_product: null }), null);
    expect(buildOfferBlock(ctx)).toBe("");
  });

  it("renders the product row's own fields with no brief", () => {
    const product = makeProduct({ price_point: "$500" });
    const ctx = makeCtx(makeTopic({ maps_to_product: "brand-audit" }), product);
    const block = buildOfferBlock(ctx);
    expect(block).toContain("RELATED OFFER: Brand audit");
    expect(block).toContain("Price point: $500");
  });

  it("brief offer_price wins over the product's own price_point", () => {
    const product = makeProduct({ price_point: "$500" });
    const ctx = makeCtx(makeTopic({ maps_to_product: "brand-audit" }), product);
    const block = buildOfferBlock(ctx, { offer_price: "$299 launch price" });
    expect(block).toContain("Price point: $299 launch price");
    expect(block).not.toContain("$500");
  });

  it("the product row fills gaps the brief doesn't cover (deliverables, description)", () => {
    const product = makeProduct({
      description: "A full audit of your brand.",
      deliverables: ["Report", "Working session"],
    });
    const ctx = makeCtx(makeTopic({ maps_to_product: "brand-audit" }), product);
    const block = buildOfferBlock(ctx, { offer_deal: "25% off for past clients" });
    expect(block).toContain("What it is: A full audit of your brand.");
    expect(block).toContain("Includes: Report; Working session");
    expect(block).toContain("Deal: 25% off for past clients");
  });

  it("renders a deadline as a plain fact and includes exclusions", () => {
    const ctx = makeCtx(makeTopic({ maps_to_product: "brand-audit" }), makeProduct());
    const block = buildOfferBlock(ctx, {
      offer_deadline: "ends Friday",
      offer_exclusions: "not for current clients",
    });
    expect(block).toContain("ends Friday");
    expect(block).toContain("Not for: not for current clients");
  });

  it("renders brief-only offer terms even with no product row at all", () => {
    const ctx = makeCtx(makeTopic({ maps_to_product: null }), null);
    const block = buildOfferBlock(ctx, { offer_deal: "25% off", offer_deadline: "ends Friday" });
    expect(block).toContain("Deal: 25% off");
    expect(block).toContain("ends Friday");
  });
});
