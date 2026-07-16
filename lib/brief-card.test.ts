import { describe, expect, it } from "vitest";
import type { Brand, CampaignBrief, Product } from "@/lib/db/types";
import { buildBriefCard } from "./brief-card";

const BRAND = { voice_profile: {} } as Brand;

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    brand_id: "b1",
    slug: "brand-audit",
    name: "Brand audit",
    description: null,
    deliverables: [],
    price_point: "$500",
    url: null,
    image_url: null,
    created_at: "2026-07-05T00:00:00Z",
    ...overrides,
  };
}

describe("buildBriefCard", () => {
  it("surfaces the vibe and whether a product photo is attached", () => {
    const card = buildBriefCard({
      brand: BRAND,
      strategy: null,
      primaryIcp: null,
      products: [],
      brief: {
        visual_vibe: "punchy",
        product_photo_url: "https://example.com/a.jpg",
      } as CampaignBrief,
      topicTitle: null,
      funnelStage: null,
    });
    expect(card.visualVibe).toBe("punchy");
    expect(card.hasProductPhoto).toBe(true);
  });

  it("defaults to null vibe and no photo on an empty brief", () => {
    const card = buildBriefCard({
      brand: BRAND,
      strategy: null,
      primaryIcp: null,
      products: [],
      brief: {} as CampaignBrief,
      topicTitle: null,
      funnelStage: null,
    });
    expect(card.visualVibe).toBeNull();
    expect(card.hasProductPhoto).toBe(false);
  });

  it("still resolves the offer name/price from the matched product", () => {
    const card = buildBriefCard({
      brand: BRAND,
      strategy: null,
      primaryIcp: null,
      products: [makeProduct()],
      brief: { offer_slug: "brand-audit" } as CampaignBrief,
      topicTitle: null,
      funnelStage: null,
    });
    expect(card.offerName).toBe("Brand audit");
    expect(card.offerPrice).toBe("$500");
  });
});
