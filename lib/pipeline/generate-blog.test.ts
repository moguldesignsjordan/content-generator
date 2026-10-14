import { describe, expect, it, vi } from "vitest";
import type { CampaignBrief, TopicContext } from "@/lib/db/types";

// The fresh-blog path must write from the per-piece brief (a factory or
// series piece's meta.series_brief) instead of the shared campaign brief.
// pickAngle is the first thing that reads the brief, so the test captures
// what it receives and stops the run there.

const getCampaign = vi.fn();
vi.mock("@/lib/db/queries", () => ({
  getCampaign: (...args: unknown[]) => getCampaign(...args),
  patchDraftGeneration: vi.fn(async () => {}),
  listFeedbackEmailExamples: vi.fn(async () => []),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

const seen: (CampaignBrief | null | undefined)[] = [];
vi.mock("./pick-angle", () => ({
  pickAngle: vi.fn(async (_ctx: unknown, opts: { brief?: CampaignBrief | null }) => {
    seen.push(opts.brief);
    throw new Error("stop here");
  }),
  chosenAngle: vi.fn(),
}));

import { generateBlogForTopicStreamed } from "./generate-blog";

const ctx = { brand: { id: "b1" }, topic: { title: "T" } } as unknown as TopicContext;

describe("generateBlogForTopicStreamed brief precedence", () => {
  it("uses the per-piece brief over the campaign's shared one", async () => {
    getCampaign.mockResolvedValue({ brief: { goal: "shared campaign brief" } });
    const override: CampaignBrief = { goal: "factory piece", hook: "Own hook" };
    await expect(
      generateBlogForTopicStreamed("d1", ctx, { campaignId: "c1", briefOverride: override }, () => {}),
    ).rejects.toThrow("stop here");
    expect(seen.at(-1)).toEqual(override);
    expect(getCampaign).not.toHaveBeenCalled();
  });

  it("still falls back to the campaign brief without an override", async () => {
    getCampaign.mockResolvedValue({ brief: { goal: "shared campaign brief" } });
    await expect(
      generateBlogForTopicStreamed("d2", ctx, { campaignId: "c1" }, () => {}),
    ).rejects.toThrow("stop here");
    expect(seen.at(-1)).toEqual({ goal: "shared campaign brief" });
  });
});

describe("generateBlogForTopicStreamed angle lock", () => {
  it("skips the angle step when the plan already locked the angle", async () => {
    const before = seen.length;
    // With the angle step skipped the run reaches the drafting call, which
    // fails here (no API key in tests); the point is pickAngle never ran.
    await expect(
      generateBlogForTopicStreamed(
        "d3",
        ctx,
        { briefOverride: { goal: "g", hook: "h", angle: "a", angle_locked: true } },
        () => {},
      ),
    ).rejects.toThrow();
    expect(seen.length).toBe(before);
  });
});
