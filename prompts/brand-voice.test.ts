import { describe, expect, it } from "vitest";
import type { CampaignBrief, Product, ReferenceEmail } from "@/lib/db/types";
import {
  buildBriefStateBlock,
  buildCampaignBriefBlock,
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
  it("reports the vibe and product photo state", () => {
    const block = buildBriefStateBlock(
      { visual_vibe: "punchy", product_photo_url: "https://example.com/a.jpg" } as CampaignBrief,
      "topic-1",
    );
    expect(block).toContain("Vibe: punchy");
    expect(block).toContain("Product photo: attached, will be the hero as-is");
  });

  it("reports attached photos with a count", () => {
    const block = buildBriefStateBlock(
      {
        photo_urls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      } as CampaignBrief,
      null,
    );
    expect(block).toContain(
      "Photos in the email: 2 attached, each will be placed in the email",
    );
  });

  it("shows the not-set defaults when the brief is empty", () => {
    const block = buildBriefStateBlock({} as CampaignBrief, null);
    expect(block).toContain("Vibe: (not set)");
    expect(block).toContain("Product photo: (none)");
    expect(block).toContain("Photos in the email: (none)");
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

  it("leads with campaign mode when a campaign is being built, and omits it otherwise", () => {
    const block = buildBriefStateBlock(
      {
        campaign_kind: "product",
        campaign_products: "business cards, door hangers",
        email_count: "2 per product, 4 total",
      } as CampaignBrief,
      null,
    );
    expect(block).toContain(
      "CAMPAIGN MODE: product campaign; products: business cards, door hangers; emails: 2 per product, 4 total (must end in plan_series)",
    );
    // Campaign mode must sit above the field rows so it can't be missed.
    expect(block.indexOf("CAMPAIGN MODE")).toBeLessThan(block.indexOf("Goal:"));
    expect(buildBriefStateBlock({} as CampaignBrief, null)).not.toContain("CAMPAIGN MODE");
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
