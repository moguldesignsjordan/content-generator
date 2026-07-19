import { describe, expect, it } from "vitest";
import type { CampaignBrief } from "@/lib/db/types";
import type { UpdateBriefInput } from "@/prompts/create-agent";
import { mergeBrief } from "./brief-merge";

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
