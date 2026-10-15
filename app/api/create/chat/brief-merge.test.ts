import { describe, expect, it } from "vitest";
import { MAX_CONVERSATION_NOTES_CHARS, type CampaignBrief } from "@/lib/db/types";
import type { UpdateBriefInput } from "@/prompts/create-agent";
import { buildConversationNotes, mergeBrief } from "./brief-merge";

describe("mergeBrief competitor_reference_id", () => {
  it("sets competitor_reference_id from a trimmed non-empty string", () => {
    const next = mergeBrief({} as CampaignBrief, {
      competitor_reference_id: "  ref-123  ",
    } as UpdateBriefInput);
    expect(next.competitor_reference_id).toBe("ref-123");
  });

  it("preserves the existing id when the input omits the field", () => {
    const current = { competitor_reference_id: "ref-existing" } as CampaignBrief;
    const next = mergeBrief(current, { goal: "Sell more" } as UpdateBriefInput);
    expect(next.competitor_reference_id).toBe("ref-existing");
  });

  it("overwrites a previously saved id with a new one", () => {
    const current = { competitor_reference_id: "ref-old" } as CampaignBrief;
    const next = mergeBrief(current, {
      competitor_reference_id: "ref-new",
    } as UpdateBriefInput);
    expect(next.competitor_reference_id).toBe("ref-new");
  });

  it("ignores an empty or whitespace-only id", () => {
    const current = { competitor_reference_id: "ref-existing" } as CampaignBrief;
    const next = mergeBrief(current, {
      competitor_reference_id: "   ",
    } as UpdateBriefInput);
    expect(next.competitor_reference_id).toBe("ref-existing");
  });
});

describe("mergeBrief flyer references and client brand", () => {
  const url = (n: number) => `https://x.supabase.co/storage/v1/object/public/content-images/${n}.jpg`;

  it("keeps up to 3 deduped valid reference URLs, and [] clears them", () => {
    const next = mergeBrief({} as CampaignBrief, {
      style_reference_urls: [url(1), url(1), "not a url", url(2), url(3), url(4)],
    });
    expect(next.style_reference_urls).toEqual([url(1), url(2), url(3)]);
    expect(mergeBrief(next, { style_reference_urls: [] }).style_reference_urls).toBeUndefined();
  });

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
