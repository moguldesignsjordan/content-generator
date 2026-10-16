import { describe, expect, it } from "vitest";
import type { Brand, CompetitorReference } from "@/lib/db/types";
import { buildPlanMessages } from "./campaign-plan";

const brand = { name: "Moguls" } as unknown as Brand;
const base = {
  brand,
  primaryIcp: null,
  products: [],
  memories: [],
  sentence: "Showcase our print products",
  counts: { social: 3, ad: 0, email: 0, blog: 0 },
};

const competitorRef = {
  id: "c1",
  brand_id: "b1",
  name: "VistaPrint: Holiday Cards",
  input_kind: "text",
  content: "Primary text: Built your way.",
  image_url: null,
  storage_path: null,
  source_url: null,
  competitor_profile: {
    summary: "Leads with flexibility.",
    hook_type: "promise",
    angle: "choice",
    structure: ["headline", "product", "CTA"],
    cta_style: "short imperative",
  },
  created_at: "2026-10-16T00:00:00Z",
} as CompetitorReference;

describe("buildPlanMessages", () => {
  it("adds no photo or competitor rules without them", () => {
    const { user } = buildPlanMessages(base);
    expect(user).not.toContain("PRODUCT PHOTOS");
    expect(user).not.toContain("COMPETITOR REFERENCE");
  });

  it("has every piece pick the photos it shows", () => {
    const { user } = buildPlanMessages({ ...base, photoCount: 4 });
    expect(user).toContain("PRODUCT PHOTOS: the 4 images above are real photos");
    expect(user).toContain("Set photos on every piece");
    expect(user).toContain("Never describe a product that isn't in one of the photos");
  });

  it("adapts the competitor ad in about a third of the pieces", () => {
    const { user } = buildPlanMessages({ ...base, competitorRef });
    expect(user).toContain("COMPETITOR REFERENCE");
    expect(user).toContain("in about a third of the pieces (1 of 3)");
    expect(user).toContain("Set uses_reference true on exactly those");
  });
});

describe("buildPlanMessages one product per piece", () => {
  const productPlan = [
    {
      name: "Business cards",
      total: 2,
      kinds: { social: 1, ad: 1, email: 0, blog: 0 },
      description: "Thick matte cards",
      price: "$60 for 500",
      photo: 2,
    },
    { name: "Door hangers", total: 1, kinds: { social: 1, ad: 0, email: 0, blog: 0 } },
  ];

  it("lists each product's exact count, details, and photo, and bans lineups", () => {
    const { user } = buildPlanMessages({ ...base, productPlan, photoCount: 2 });
    expect(user).toContain("ONE PRODUCT PER PIECE");
    expect(user).toContain(
      "  - Business cards: 2 pieces (1 social, 1 ad). About it: Thick matte cards. Price: $60 for 500. Its photo: number 2.",
    );
    expect(user).toContain("  - Door hangers: 1 piece (1 social).");
    expect(user).toContain("Never show, list, or mention the other products");
    expect(user).toContain("only to photos of ITS product");
    expect(user).not.toContain("several together when the piece is about more than one product");
  });

  it("keeps the mixed-idea rules without products", () => {
    const { user } = buildPlanMessages({ ...base, photoCount: 1 });
    expect(user).not.toContain("ONE PRODUCT PER PIECE");
    expect(user).toContain("several together when the piece is about more than one product");
  });
});
