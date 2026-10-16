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
