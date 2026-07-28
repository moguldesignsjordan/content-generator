import { describe, expect, it } from "vitest";
import type { Cluster, Icp, Pillar, Topic, TopicContext } from "@/lib/db/types";
import { buildStrategyBlock } from "./brand-voice";

function makeCtx(overrides: Partial<TopicContext> = {}): TopicContext {
  const topic = {
    id: "t1",
    cluster_id: "c1",
    title: "How to brief a designer",
    target_keyword: "design brief",
    intent: "informational",
    funnel_stage: "awareness",
    internal_link_targets: [],
    maps_to_product: null,
    distribution_recipe: [],
    status: "idea",
    published_url: null,
    archived: false,
    keyword_data: {},
    created_at: "2026-07-05T00:00:00Z",
  } as Topic;

  return {
    topic,
    brand: { id: "b1", name: "Mogul" } as TopicContext["brand"],
    strategy: { id: "s1" } as TopicContext["strategy"],
    primaryIcp: null,
    product: null,
    ...overrides,
  };
}

const pillar: Pillar = {
  id: "p1",
  strategy_id: "s1",
  name: "Design education",
  description: "Teaching founders how design decisions get made.",
  business_goal: "Win trust before the sales call",
  primary_funnel_stage: "awareness",
  target_icp_id: null,
};

const cluster: Cluster = {
  id: "c1",
  pillar_id: "p1",
  hub_title: "Working with designers",
  hub_keyword: "work with a designer",
  hub_intent: "Founders about to hire their first designer",
};

function makeIcp(id: string, label: string, isPrimary: boolean): Icp {
  return { id, strategy_id: "s1", label, is_primary: isPrimary, profile: {} };
}

describe("buildStrategyBlock", () => {
  it("returns empty string when the context has no pillar or cluster", () => {
    // Chat surfaces and tests build TopicContext by hand; they must not break.
    expect(buildStrategyBlock(makeCtx())).toBe("");
  });

  it("names the pillar's business goal, which is the point of the block", () => {
    const block = buildStrategyBlock(makeCtx({ pillar, cluster }));
    expect(block).toContain("Content pillar: Design education");
    expect(block).toContain("Business goal this pillar serves: Win trust before the sales call");
    expect(block).toContain("Topic cluster: Working with designers");
    expect(block).toContain("Reader intent for the cluster: Founders about to hire");
  });

  it("tells the model to use the strategy without narrating it", () => {
    const block = buildStrategyBlock(makeCtx({ pillar }));
    expect(block).toContain("use it to choose the angle");
    expect(block).toContain("not as something to mention out loud");
  });

  it("lists secondary audiences but never the primary one", () => {
    const primary = makeIcp("i1", "Solo founders", true);
    const secondary = makeIcp("i2", "Agency owners", false);
    const block = buildStrategyBlock(
      makeCtx({ pillar, primaryIcp: primary, icps: [primary, secondary] }),
    );
    expect(block).toContain("Agency owners");
    expect(block).not.toContain("Solo founders");
  });

  it("omits the secondary-audience line when there is only a primary ICP", () => {
    const primary = makeIcp("i1", "Solo founders", true);
    const block = buildStrategyBlock(
      makeCtx({ pillar, primaryIcp: primary, icps: [primary] }),
    );
    expect(block).not.toContain("Also reading");
  });

  it("passes through internal link targets for natural cross-referencing", () => {
    const ctx = makeCtx({ pillar });
    ctx.topic.internal_link_targets = ["/blog/design-systems"];
    expect(buildStrategyBlock(ctx)).toContain("/blog/design-systems");
  });
});
