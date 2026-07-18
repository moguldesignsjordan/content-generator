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

  it("projects proof, hook, and reader belief", () => {
    const card = buildBriefCard({
      brand: BRAND,
      strategy: null,
      primaryIcp: null,
      products: [],
      brief: {
        proof: "Cut load times from 4.2s to 0.9s",
        hook: "Open with the before/after",
        reader_belief: "feel ready to book",
      } as CampaignBrief,
      topicTitle: null,
      funnelStage: null,
    });
    expect(card.proof).toBe("Cut load times from 4.2s to 0.9s");
    expect(card.hook).toBe("Open with the before/after");
    expect(card.readerBelief).toBe("feel ready to book");
  });

  it("defaults proof/hook/reader belief/offerSummary to null when unset", () => {
    const card = buildBriefCard({
      brand: BRAND,
      strategy: null,
      primaryIcp: null,
      products: [],
      brief: {} as CampaignBrief,
      topicTitle: null,
      funnelStage: null,
    });
    expect(card.proof).toBeNull();
    expect(card.hook).toBeNull();
    expect(card.readerBelief).toBeNull();
    expect(card.offerSummary).toBeNull();
  });

  it("joins the brief's own offer_deal/deadline/exclusions into offerSummary, separately from product price", () => {
    const card = buildBriefCard({
      brand: BRAND,
      strategy: null,
      primaryIcp: null,
      products: [makeProduct()],
      brief: {
        offer_slug: "brand-audit",
        offer_deal: "25% off",
        offer_deadline: "ends Friday",
        offer_exclusions: "not for current clients",
      } as CampaignBrief,
      topicTitle: null,
      funnelStage: null,
    });
    expect(card.offerSummary).toBe("25% off · ends Friday · not for current clients");
    expect(card.offerPrice).toBe("$500");
  });

  it("brief offer_price overrides the product's own price_point on the card", () => {
    const card = buildBriefCard({
      brand: BRAND,
      strategy: null,
      primaryIcp: null,
      products: [makeProduct()],
      brief: { offer_slug: "brand-audit", offer_price: "$299 launch price" } as CampaignBrief,
      topicTitle: null,
      funnelStage: null,
    });
    expect(card.offerPrice).toBe("$299 launch price");
  });
});
