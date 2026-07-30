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
