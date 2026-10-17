import { describe, expect, it } from "vitest";
import { buildBusinessResearchMessages, parseBusinessResearch } from "./research-business";

// Built at runtime so this file never contains the banned character itself.
const EM_DASH = String.fromCharCode(0x2014);

const known = [
  { url: "https://www.yelp.com/biz/acme-roofing-dallas", title: "Acme Roofing on Yelp" },
  { url: "https://www.google.com/maps/place/acme", title: "Acme Roofing" },
];

describe("parseBusinessResearch", () => {
  it("drops facts and items whose source the tools never returned", () => {
    const out = parseBusinessResearch(
      {
        phone: { value: "214-555-0101", source: "https://www.yelp.com/biz/acme-roofing-dallas" },
        postal_address: { value: "1 Main St", source: "https://invented.example.com" },
        praise: [
          { point: "Fast and tidy", sources: ["https://www.google.com/maps/place/acme"] },
          { point: "Made up praise", sources: ["https://invented.example.com"] },
          { point: "No source at all", sources: [] },
        ],
      },
      { knownSources: known },
    );
    expect(out.phone).toBe("(214) 555-0101");
    expect(out.postal_address).toBeUndefined();
    expect(out.praise).toEqual(["Fast and tidy"]);
    expect(out.sources.map((s) => s.url)).toEqual([
      "https://www.yelp.com/biz/acme-roofing-dallas",
      "https://www.google.com/maps/place/acme",
    ]);
  });

  it("accepts the business's own pages as sources", () => {
    const out = parseBusinessResearch(
      { guarantee: { value: "10-year warranty", source: "https://acmeroofing.com/warranty" } },
      { knownSources: [], website: "https://www.acmeroofing.com" },
    );
    expect(out.guarantee).toBe("10-year warranty");
  });

  it("takes a found website only from a sourced listing, and trusts its pages after", () => {
    const out = parseBusinessResearch(
      {
        website: { value: "https://acmeroofing.com", source: "https://www.google.com/maps/place/acme" },
        rating: { value: "4.8 stars", source: "https://acmeroofing.com/reviews" },
      },
      { knownSources: known },
    );
    expect(out.website).toBe("https://acmeroofing.com");
    expect(out.rating).toBe("4.8 stars");
  });

  it("strips em dashes, dedupes, and caps the lists", () => {
    const src = ["https://www.yelp.com/biz/acme-roofing-dallas"];
    const out = parseBusinessResearch(
      {
        customer_words: ["a", "b", "c", "d", "e", "f", "g", "A"].map((point) => ({ point, sources: src })),
        competitors: [{ point: `Big Roof Co ${EM_DASH} Dallas`, sources: src }],
      },
      { knownSources: known },
    );
    expect(out.customer_words).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(out.competitors[0]).not.toContain(EM_DASH);
  });

  it("keeps a sourced main action and drops an unknown kind", () => {
    const src = "https://www.yelp.com/biz/acme-roofing-dallas";
    expect(
      parseBusinessResearch({ main_action: { kind: "quote", wording: "a free estimate", source: src } }, { knownSources: known })
        .main_action,
    ).toEqual({ kind: "quote", wording: "a free estimate" });
    expect(
      parseBusinessResearch({ main_action: { kind: "fax", source: src } }, { knownSources: known }).main_action,
    ).toBeUndefined();
  });

  it("returns empty lists for empty input", () => {
    const out = parseBusinessResearch(undefined, { knownSources: [] });
    expect(out.praise).toEqual([]);
    expect(out.sources).toEqual([]);
  });
});

describe("buildBusinessResearchMessages", () => {
  it("asks to find a website only when the owner has none", () => {
    expect(buildBusinessResearchMessages({ name: "Acme", city: "Dallas" }).user).toContain("Find its own website");
    expect(buildBusinessResearchMessages({ url: "https://acmeroofing.com" }).user).not.toContain(
      "Find its own website",
    );
  });
});
