import { describe, expect, it } from "vitest";
import type {
  Brand,
  BrandMemory,
  CampaignBrief,
  CompetitorReference,
  Icp,
  Product,
  ReferenceEmail,
} from "@/lib/db/types";
import {
  buildBrandContext,
  buildBriefStateBlock,
  buildCampaignBriefBlock,
  buildCompetitorReferenceBlock,
  buildKeywordLines,
  buildProductLines,
  buildReferenceEmailsBlock,
} from "./brand-voice";

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
    image_url: null,
    created_at: "2026-07-05T00:00:00Z",
    ...overrides,
  };
}

describe("buildKeywordLines", () => {
  it("falls back to the raw topic fields when the topic hasn't been researched", () => {
    expect(
      buildKeywordLines({
        target_keyword: "cold email tips",
        intent: "informational",
        keyword_data: {},
      }),
    ).toEqual([
      "TARGET KEYWORD: cold email tips",
      "SEARCH INTENT: informational",
    ]);
  });

  it("cites validated figures and secondary keywords once researched", () => {
    const lines = buildKeywordLines({
      target_keyword: "cold email tips",
      intent: "informational",
      keyword_data: {
        primary: {
          keyword: "cold email tips",
          search_volume: 1300,
          difficulty: 34,
          intent: "informational",
          cpc: 2.5,
          competition: "LOW",
        },
        secondary: [
          {
            keyword: "cold email templates",
            search_volume: 880,
            difficulty: 41,
            intent: null,
            cpc: 3.1,
            competition: "MEDIUM",
          },
        ],
      },
    });

    expect(lines[0]).toBe(
      "TARGET KEYWORD (DataForSEO-validated): cold email tips (~1300/mo searches, difficulty 34/100, informational intent)",
    );
    expect(lines[1]).toBe(
      "SECONDARY KEYWORDS (work in naturally where they fit): cold email templates (~880/mo)",
    );
  });

  it("omits the secondary line when there are no secondary keywords", () => {
    const lines = buildKeywordLines({
      target_keyword: "b2b newsletter ideas",
      intent: null,
      keyword_data: {
        primary: {
          keyword: "b2b newsletter ideas",
          search_volume: 210,
          difficulty: null,
          intent: null,
          cpc: null,
          competition: null,
        },
        secondary: [],
      },
    });

    expect(lines).toEqual([
      "TARGET KEYWORD (DataForSEO-validated): b2b newsletter ideas (~210/mo searches)",
    ]);
  });
});

describe("buildProductLines", () => {
  it("flags products that have a real photo on file", () => {
    const lines = buildProductLines([
      makeProduct({ slug: "with-photo", image_url: "https://example.com/a.jpg" }),
      makeProduct({ slug: "no-photo", image_url: null }),
    ]);
    expect(lines[0]).toContain("[has a real photo on file]");
    expect(lines[1]).not.toContain("[has a real photo on file]");
  });

  it("falls back to a placeholder when there are no products", () => {
    expect(buildProductLines([])).toEqual(["  (none on file)"]);
  });
});

describe("buildBriefStateBlock", () => {
  it("reports the vibe and a legacy brief's product photo", () => {
    const block = buildBriefStateBlock(
      { visual_vibe: "punchy", product_photo_url: "https://example.com/a.jpg" } as CampaignBrief,
      "topic-1",
    );
    expect(block).toContain("Vibe: punchy");
    expect(block).toContain("Photos to use in the picture: 1, the first one leads: https://example.com/a.jpg");
  });

  it("reports attached photos with a count", () => {
    const block = buildBriefStateBlock(
      {
        inputs: { photos: ["https://example.com/a.jpg", "https://example.com/b.jpg"] },
      } as CampaignBrief,
      null,
    );
    expect(block).toContain("Photos to use in the picture: 2, the first one leads");
  });

  it("shows the not-set defaults when the brief is empty", () => {
    const block = buildBriefStateBlock({} as CampaignBrief, null);
    expect(block).toContain("Vibe: (not set)");
    expect(block).toContain("Photos to use in the picture: (none)");
    expect(block).toContain("Style: Our style");
    expect(block).toContain("Proof: (not set)");
    expect(block).toContain("Hook: (not set)");
    expect(block).toContain("Reader belief: (not set)");
    expect(block).toContain("Offer terms: (not set)");
  });

  it("reports proof, hook, reader belief, and joined offer terms when set", () => {
    const block = buildBriefStateBlock(
      {
        proof: "Cut load times from 4.2s to 0.9s",
        hook: "Open with the before/after",
        reader_belief: "feel ready to book",
        offer_deal: "25% off",
        offer_deadline: "ends Friday",
        offer_price: "$499",
      } as CampaignBrief,
      null,
    );
    expect(block).toContain("Proof: Cut load times from 4.2s to 0.9s");
    expect(block).toContain("Hook: Open with the before/after");
    expect(block).toContain("Reader belief: feel ready to book");
    expect(block).toContain("Offer terms: 25% off; ends Friday; $499");
  });

  it("reports the chosen name and subheader, with not-set defaults otherwise", () => {
    const set = buildBriefStateBlock(
      { subject_line: "The Card They Won't Throw Away", preheader: "1K cards, $60, shipped" } as CampaignBrief,
      null,
    );
    expect(set).toContain("Name (subject line): The Card They Won't Throw Away");
    expect(set).toContain("Subheader: 1K cards, $60, shipped");
    const unset = buildBriefStateBlock({} as CampaignBrief, null);
    expect(unset).toContain("Name (subject line): (not set)");
    expect(unset).toContain("Subheader: (not set)");
  });

  it("says what's being made, for which products, and how they're split", () => {
    const block = buildBriefStateBlock(
      {
        making: "flyer",
        products: ["Business cards", "Door hangers"],
        split: "each",
        per_product: 3,
      } as CampaignBrief,
      null,
    );
    expect(block).toContain(
      "Making: a flyer (a social post image), a set: one design per product, made through the planner",
    );
    expect(block).toContain("Products: Business cards, Door hangers; a separate design for each, 3 each");
    // What's being made leads, so it can't be scanned past.
    expect(block.indexOf("Making:")).toBeLessThan(block.indexOf("Goal:"));
    expect(buildBriefStateBlock({} as CampaignBrief, null)).toContain("Making: (not decided yet)");
  });

  it("counts a per-product set, and flags one over the 20-piece cap", () => {
    const set = { making: "flyer", products: ["A", "B", "C"], split: "each" } as CampaignBrief;
    expect(buildBriefStateBlock({ ...set, per_product: 3 }, null)).toContain("  Size: 9 pieces");
    expect(buildBriefStateBlock({ ...set, products: ["A", "B", "C", "D"], per_product: 6 }, null)).toContain(
      "24 pieces asked for, over the 20-piece cap",
    );
  });

  it("shows email-only lines only for an email or an undecided kind", () => {
    expect(buildBriefStateBlock({ making: "email" } as CampaignBrief, null)).toContain("Subheader:");
    const flyer = buildBriefStateBlock({ making: "flyer" } as CampaignBrief, null);
    expect(flyer).not.toContain("Subheader:");
    expect(flyer).not.toContain("Length:");
    expect(flyer).not.toContain("Reader belief:");
  });

  it("ends with the checklist: what's open and what was asked", () => {
    const open = buildBriefStateBlock({ making: "campaign", key_message: "x" } as CampaignBrief, null);
    expect(open).toContain("STILL OPEN (ask only these");
    expect(open).toContain("channels (");
    const asked = buildBriefStateBlock(
      { making: "campaign", key_message: "x", asked: ["channels", "products", "size"] } as CampaignBrief,
      null,
    );
    expect(asked).toContain("ASKED ALREADY OR SKIPPED");
    expect(asked).toContain("channels: posts, ads, emails, and a blog post");
    expect(asked).not.toContain("plan_series");
  });
});

describe("buildCampaignBriefBlock", () => {
  it("pins the user-approved subject line and preheader for generation", () => {
    const block = buildCampaignBriefBlock({
      goal: "Sell the thing",
      subject_line: "Go Big. Get Noticed.",
      preheader: "Retractable banners built for your brand",
    } as CampaignBrief);
    expect(block).toContain(
      "SUBJECT LINE (user-approved; use it VERBATIM as the subject, do not rewrite it): Go Big. Get Noticed.",
    );
    expect(block).toContain(
      "PREHEADER (user-approved; use it near-verbatim as the preview text): Retractable banners built for your brand",
    );
    // Unset means no line at all, not an empty directive.
    const bare = buildCampaignBriefBlock({ goal: "Sell the thing" } as CampaignBrief);
    expect(bare).not.toContain("SUBJECT LINE");
    expect(bare).not.toContain("PREHEADER");
  });

  it("includes the visual vibe when set", () => {
    const block = buildCampaignBriefBlock({
      goal: "Sell the thing",
      visual_vibe: "playful",
    } as CampaignBrief);
    expect(block).toContain("Visual/verbal vibe: playful");
  });

  it("omits the vibe line when unset", () => {
    const block = buildCampaignBriefBlock({ goal: "Sell the thing" } as CampaignBrief);
    expect(block).not.toContain("Visual/verbal vibe");
  });

  it("renders proof, hook, and reader belief with their per-field framing", () => {
    const block = buildCampaignBriefBlock({
      goal: "Sell the thing",
      proof: "Cut load times from 4.2s to 0.9s for Acme Co",
      hook: "Open with the before/after",
      reader_belief: "feel ready to book",
    } as CampaignBrief);
    expect(block).toContain("PROOF");
    expect(block).toContain("use it near-verbatim");
    expect(block).toContain("Cut load times from 4.2s to 0.9s for Acme Co");
    expect(block).toContain("HOOK");
    expect(block).toContain("Open with the before/after");
    expect(block).toContain("Reader belief: after reading they should feel ready to book");
  });

  it("omits proof/hook/reader belief lines when unset", () => {
    const block = buildCampaignBriefBlock({ goal: "Sell the thing" } as CampaignBrief);
    expect(block).not.toContain("PROOF");
    expect(block).not.toContain("HOOK");
    expect(block).not.toContain("Reader belief");
  });
});

function makeReference(overrides: Partial<ReferenceEmail> = {}): ReferenceEmail {
  return {
    id: "r1",
    brand_id: "b1",
    name: "April promo",
    content: "Hey there,\n\nShort and punchy body.\n\nJordan",
    style_profile: {
      summary: "Short, casual, first-person notes with one plain CTA.",
      traits: ["Open with a one-line hook", "Keep paragraphs to 1-2 sentences"],
      approx_words: 120,
    },
    created_at: "2026-07-13T00:00:00Z",
    ...overrides,
  };
}

describe("buildReferenceEmailsBlock", () => {
  it("returns an empty string when the library is empty or missing", () => {
    expect(buildReferenceEmailsBlock(undefined)).toBe("");
    expect(buildReferenceEmailsBlock([])).toBe("");
  });

  it("includes distilled traits and the raw email body", () => {
    const block = buildReferenceEmailsBlock([makeReference()]);
    expect(block).toContain("REFERENCE EMAILS");
    expect(block).toContain("Short, casual, first-person notes");
    expect(block).toContain("- Open with a one-line hook");
    expect(block).toContain("Short and punchy body.");
    expect(block).toContain("~120 words");
  });

  it("skips the traits section for a row whose extraction failed, but keeps its raw text", () => {
    const block = buildReferenceEmailsBlock([
      makeReference({ style_profile: null, content: "Raw only body text." }),
    ]);
    expect(block).toContain("Raw only body text.");
  });

  it("injects at most two full reference bodies", () => {
    const refs = [1, 2, 3].map((n) =>
      makeReference({ id: `r${n}`, name: `Ref ${n}`, content: `BODY_${n}` }),
    );
    const block = buildReferenceEmailsBlock(refs);
    expect(block).toContain("BODY_1");
    expect(block).toContain("BODY_2");
    expect(block).not.toContain("BODY_3");
  });

  it("truncates an oversized reference body", () => {
    const block = buildReferenceEmailsBlock([
      makeReference({ content: "x".repeat(5000) }),
    ]);
    expect(block).toContain("[truncated]");
    expect(block.length).toBeLessThan(5000);
  });
});

function makeCompetitorReference(
  overrides: Partial<CompetitorReference> = {},
): CompetitorReference {
  return {
    id: "c1",
    brand_id: "b1",
    name: "Acme Black Friday ad",
    input_kind: "text",
    content: "50% off everything, today only!",
    image_url: null,
    storage_path: null,
    source_url: null,
    competitor_profile: {
      summary: "Leads with a bold discount claim, then stacks urgency.",
      hook_type: "bold claim",
      angle: "urgency",
      structure: ["headline discount", "countdown timer", "single CTA button"],
      persuasion_levers: ["scarcity", "social proof"],
      cta_style: "direct and urgent",
      register: "casual",
    },
    created_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

describe("buildCompetitorReferenceBlock", () => {
  it("returns an empty string when there's no reference or no distilled profile", () => {
    expect(buildCompetitorReferenceBlock(null)).toBe("");
    expect(buildCompetitorReferenceBlock(undefined)).toBe("");
    expect(
      buildCompetitorReferenceBlock(makeCompetitorReference({ competitor_profile: null })),
    ).toBe("");
  });

  it("includes the anti-copy framing and the distilled strategy fields", () => {
    const block = buildCompetitorReferenceBlock(makeCompetitorReference());
    expect(block).toContain("DO NOT COPY");
    expect(block).toContain("NEVER reproduce the");
    expect(block).toContain("Hook type: bold claim");
    expect(block).toContain("Angle: urgency");
    expect(block).toContain("headline discount -> countdown timer -> single CTA button");
    expect(block).toContain("CTA style: direct and urgent");
    expect(block).toContain("Persuasion levers: scarcity, social proof");
    expect(block).toContain("Register: casual");
  });

  it("includes the ad's wording as a suggestion, with the no-copy rules", () => {
    const block = buildCompetitorReferenceBlock(makeCompetitorReference());
    expect(block).toContain("THEIR WORDING (a suggestion, not a script)");
    expect(block).toContain("50% off everything, today only!");
    expect(block).toContain("any whole sentence or headline as written");
  });

  it("omits the wording section when no ad text was saved", () => {
    const block = buildCompetitorReferenceBlock(makeCompetitorReference({ content: null }));
    expect(block).not.toContain("THEIR WORDING");
  });

  it("truncates long ad text", () => {
    const block = buildCompetitorReferenceBlock(
      makeCompetitorReference({ content: "word ".repeat(1000) }),
    );
    expect(block).toContain("[truncated]");
  });

  it("leaves out the saved name, which can carry the competitor's headline", () => {
    const block = buildCompetitorReferenceBlock(
      makeCompetitorReference({ name: "Acme: Holiday Cards | 10 from $8.56" }),
    );
    expect(block).not.toContain("Holiday Cards");
    expect(block).not.toContain("$8.56");
  });

  it("omits optional persuasion_levers/register lines when unset", () => {
    const block = buildCompetitorReferenceBlock(
      makeCompetitorReference({
        competitor_profile: {
          summary: "A quick summary.",
          hook_type: "question",
          angle: "curiosity",
          structure: ["headline", "body", "CTA"],
          cta_style: "soft invite",
        },
      }),
    );
    expect(block).not.toContain("Persuasion levers");
    expect(block).not.toContain("Register:");
  });
});

describe("buildBriefStateBlock inputs", () => {
  it("reports the competitor ads, including a legacy brief's", () => {
    expect(buildBriefStateBlock({ competitor_reference_id: "c1" } as CampaignBrief, null)).toContain(
      "Competitor ads: 1 (the first shapes the words",
    );
    expect(buildBriefStateBlock({} as CampaignBrief, null)).toContain("Competitor ads: (none)");
  });

  it("lists the photos with their URLs and names the style", () => {
    const block = buildBriefStateBlock(
      {
        inputs: {
          photos: ["https://x/a.jpg", "https://x/b.jpg"],
          style_images: { urls: ["https://x/ad.jpg"], from: "competitor" },
        },
      } as CampaignBrief,
      null,
    );
    expect(block).toContain("Photos to use in the picture: 2, the first one leads: https://x/a.jpg, https://x/b.jpg");
    expect(block).toContain("Style: follows their ads (1), in the brand's colors and logo");
  });

  it("keeps the ads as an option while Our style is picked", () => {
    const block = buildBriefStateBlock(
      {
        inputs: { style_images: { urls: ["https://x/ad.jpg"], from: "competitor" }, style: { kind: "our" } },
      } as CampaignBrief,
      null,
    );
    expect(block).toContain("Style: Our style; their ads (1) kept as an option in the look picker");
  });
});

describe("buildCampaignBriefBlock style_example", () => {
  it("injects the per-piece style example with the match-style instruction", () => {
    const block = buildCampaignBriefBlock({
      goal: "Book calls",
      style_example: "Subject: hi\n\nA tiny example email.",
    });
    expect(block).toContain("STYLE EXAMPLE");
    expect(block).toContain("A tiny example email.");
    expect(block).toContain("NEVER");
  });

  it("omits the style section when no example was given", () => {
    expect(buildCampaignBriefBlock({ goal: "Book calls" })).not.toContain(
      "STYLE EXAMPLE",
    );
  });
});

describe("buildBrandContext", () => {
  const brand = {
    name: "Moguls",
    voice_profile: { voice: "Direct and warm" },
    guidelines: { do_language: ["Say 'you'"] },
  } as unknown as Brand;

  it("puts guidelines, voice, then what the chat learned, without forget ids", () => {
    const block = buildBrandContext(
      { brand, primaryIcp: null, memories: [{ id: "m1", content: "Never mention discounts" } as BrandMemory] },
      "social",
    );
    expect(block.indexOf("BRAND: Moguls")).toBeGreaterThan(-1);
    expect(block.indexOf("Say 'you'")).toBeLessThan(block.indexOf("BRAND: Moguls"));
    expect(block).toContain("THINGS LEARNED ABOUT THIS ACCOUNT");
    expect(block).toContain("  - Never mention discounts");
    expect(block).not.toContain("m1");
  });

  it("leaves the learned section out when there's nothing learned", () => {
    expect(buildBrandContext({ brand, primaryIcp: null })).not.toContain("THINGS LEARNED");
  });

  it("prints the service area and main action in the positioning block", () => {
    const block = buildBrandContext({
      brand: {
        ...brand,
        positioning: {
          service_area: "Dallas and the suburbs",
          main_action: "Call (214) 555-0101 for a free roof inspection",
        },
      } as Brand,
      primaryIcp: null,
    });
    expect(block).toContain("POSITIONING:");
    expect(block).toContain("  Where we work: Dallas and the suburbs");
    expect(block).toContain("Call (214) 555-0101 for a free roof inspection");
  });

  it("skips the audience header for an ICP with an empty profile", () => {
    const icp = { id: "i1", label: "Primary ICP", is_primary: true, profile: {} } as Icp;
    expect(buildBrandContext({ brand, primaryIcp: icp })).not.toContain("PRIMARY AUDIENCE");
    const real = { ...icp, label: "Homeowners", profile: { pains: ["Leaks"] } } as Icp;
    expect(buildBrandContext({ brand, primaryIcp: real })).toContain('PRIMARY AUDIENCE, "Homeowners"');
  });
});

describe("buildCampaignBriefBlock for social", () => {
  const brief = {
    goal: "Sell door hangers",
    subject_line: "Door hangers that work",
    preheader: "Printed fast",
    style_example: "An email to read like",
    offer_deal: "20% off",
    offer_deadline: "Friday",
    conversation_notes: "We print in 48 hours",
  } as CampaignBrief;

  it("drops the email-only lines and carries the offer terms", () => {
    const block = buildCampaignBriefBlock(brief, "social");
    expect(block).not.toContain("SUBJECT LINE");
    expect(block).not.toContain("PREHEADER");
    expect(block).not.toContain("STYLE EXAMPLE");
    expect(block).toContain("OFFER (real, from the user; use exactly these terms): 20% off; deadline Friday");
    expect(block).toContain("WHAT THE USER ACTUALLY SAID");
  });

  it("keeps the email block unchanged by default", () => {
    const block = buildCampaignBriefBlock(brief);
    expect(block).toContain("SUBJECT LINE");
    expect(block).not.toContain("OFFER (real");
  });
});
