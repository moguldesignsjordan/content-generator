import { describe, expect, it } from "vitest";
import { MAX_CONVERSATION_NOTES_CHARS, type CampaignBrief } from "@/lib/db/types";
import type { UpdateBriefInput } from "@/prompts/create-agent";
import { buildConversationNotes, mergeBrief } from "./brief-merge";

describe("mergeBrief competitor ads", () => {
  it("puts a trimmed id first, so it shapes the copy", () => {
    const next = mergeBrief({ inputs: { competitor_reference_ids: ["ref-old"] } } as CampaignBrief, {
      competitor_reference_id: "  ref-123  ",
    } as UpdateBriefInput);
    expect(next.inputs?.competitor_reference_ids).toEqual(["ref-123", "ref-old"]);
  });

  it("keeps the saved ids when the input omits the field, and ignores a blank id", () => {
    const current = { inputs: { competitor_reference_ids: ["ref-existing"] } } as CampaignBrief;
    expect(mergeBrief(current, { goal: "Sell more" }).inputs?.competitor_reference_ids).toEqual(["ref-existing"]);
    expect(
      mergeBrief(current, { competitor_reference_id: "   " } as UpdateBriefInput).inputs?.competitor_reference_ids,
    ).toEqual(["ref-existing"]);
  });

  it("moves a legacy competitor_reference_id into inputs", () => {
    const next = mergeBrief({ competitor_reference_id: "ref-legacy" } as CampaignBrief, { goal: "g" });
    expect(next.competitor_reference_id).toBeUndefined();
    expect(next.inputs?.competitor_reference_ids).toEqual(["ref-legacy"]);
  });
});

describe("mergeBrief checklist fields", () => {
  it("saves what's being made, channels, size with its days, products, and split", () => {
    const next = mergeBrief({} as CampaignBrief, {
      making: "campaign",
      channels: ["social", "fax" as never, "email"],
      size: 6,
      products: [" Business cards ", "business cards", "Banners"],
      split: "each",
    });
    expect(next).toMatchObject({
      making: "campaign",
      channels: ["social", "email"],
      size: 6,
      days: 14,
      products: ["Business cards", "Banners"],
      split: "each",
    });
  });

  it("ignores invalid values, and [] clears the products", () => {
    const current = { making: "flyer", products: ["Cards"], split: "together" } as CampaignBrief;
    const next = mergeBrief(current, {
      making: "poster" as never,
      size: 7,
      split: "sideways" as never,
    });
    expect(next).toEqual(current);
    expect(mergeBrief(current, { products: [] }).products).toBeUndefined();
  });

  it("no longer carries the retired campaign interview fields", () => {
    const next = mergeBrief({} as CampaignBrief, { campaign_kind: "product" } as UpdateBriefInput);
    expect(next).not.toHaveProperty("campaign_kind");
  });
});

describe("mergeBrief photos and style images", () => {
  const url = (n: number) => `https://x.supabase.co/storage/v1/object/public/content-images/${n}.jpg`;

  it("replaces the photos with valid, deduped URLs, and [] clears them", () => {
    const next = mergeBrief({ inputs: { photos: [url(9)] } } as CampaignBrief, {
      photos: [url(1), url(1), "not a url", url(2)],
    });
    expect(next.inputs?.photos).toEqual([url(1), url(2)]);
    expect(mergeBrief(next, { photos: [] }).inputs).toBeUndefined();
  });

  it("clears the photos for an AI image instead", () => {
    expect(mergeBrief({ inputs: { photos: [url(1)] } } as CampaignBrief, { use_ai_image_instead: true }).inputs).toBeUndefined();
  });

  it("keeps up to 3 style images, and [] goes back to Our style", () => {
    const next = mergeBrief({} as CampaignBrief, {
      style_images: [url(1), url(1), "not a url", url(2), url(3), url(4)],
    });
    expect(next.inputs).toEqual({
      style_images: { urls: [url(1), url(2), url(3)], from: "upload" },
      style: { kind: "images" },
    });
    expect(mergeBrief(next, { style_images: [] }).inputs).toBeUndefined();
  });

  it("moves a legacy brief's photos and designs into inputs", () => {
    const next = mergeBrief(
      { product_photo_url: url(1), photo_urls: [url(2)], style_reference_urls: [url(3)] } as CampaignBrief,
      { goal: "g" },
    );
    expect(next.product_photo_url).toBeUndefined();
    expect(next.photo_urls).toBeUndefined();
    expect(next.style_reference_urls).toBeUndefined();
    expect(next.inputs).toEqual({
      photos: [url(1), url(2)],
      style_images: { urls: [url(3)], from: "upload" },
      style: { kind: "images" },
    });
  });
});

describe("mergeBrief client brand", () => {
  const url = (n: number) => `https://x.supabase.co/storage/v1/object/public/content-images/${n}.jpg`;

  it("saves a client brand with valid hex colors and a real logo URL only", () => {
    const next = mergeBrief({} as CampaignBrief, {
      client_brand: { name: " The Tax Moguls ", colors: ["#000000", "green", "#1DB954"], logo_url: url(9) },
    });
    expect(next.client_brand).toEqual({ name: "The Tax Moguls", colors: ["#000000", "#1DB954"], logo_url: url(9) });
    const noLogo = mergeBrief({} as CampaignBrief, { client_brand: { name: "Acme", logo_url: "made-up" } });
    expect(noLogo.client_brand).toEqual({ name: "Acme" });
  });

  it("ignores a client brand without a name", () => {
    expect(mergeBrief({} as CampaignBrief, { client_brand: { colors: ["#000000"] } }).client_brand).toBeUndefined();
  });
});

describe("buildConversationNotes", () => {
  it("keeps only the user's turns, oldest first", () => {
    const notes = buildConversationNotes(
      [
        { role: "user", content: "promo email for door hangers" },
        { role: "assistant", content: "What kind of email is this?" },
        { role: "user", content: "we did 4000 for a roofer last month" },
      ],
      "make it punchy",
    );
    expect(notes).toBe(
      "promo email for door hangers\n---\nwe did 4000 for a roofer last month\n---\nmake it punchy",
    );
  });

  it("strips the brief-state scaffolding the route prepends", () => {
    const notes = buildConversationNotes(
      [{ role: "user", content: "BRIEF SO FAR\n  Goal: x\n\nUSER MESSAGE:\nsell door hangers" }],
      "go",
    );
    expect(notes).toBe("sell door hangers\n---\ngo");
  });

  it("caps from the end so the newest answers survive", () => {
    const notes = buildConversationNotes(
      [{ role: "user", content: "x".repeat(MAX_CONVERSATION_NOTES_CHARS) }],
      "the newest thing",
    );
    expect(notes.length).toBe(MAX_CONVERSATION_NOTES_CHARS);
    expect(notes.endsWith("the newest thing")).toBe(true);
  });

  it("returns empty string when there is nothing to keep", () => {
    expect(buildConversationNotes([], "   ")).toBe("");
  });
});
