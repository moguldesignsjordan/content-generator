import { describe, expect, it } from "vitest";
import { buildInternalLinkTargets, MAX_INTERNAL_LINKS, type LinkCandidate } from "./internal-links";

const topic = { id: "t-1", cluster_id: "c-1", internal_link_targets: [] as string[] };
const SITE = "https://moguldesignagency.com";
const post = (slug: string) => `${SITE}/blog/${slug}`;

function candidate(overrides: Partial<LinkCandidate>): LinkCandidate {
  return {
    id: "t-x",
    title: "A post",
    cluster_id: "c-1",
    published_url: "https://moguldesignagency.com/blog/a-post",
    ...overrides,
  };
}

describe("buildInternalLinkTargets", () => {
  it("lists same-cluster posts before the rest of the pillar", () => {
    const out = buildInternalLinkTargets(
      topic,
      [
        candidate({ id: "p", title: "Pillar post", cluster_id: "c-2", published_url: post("p") }),
        candidate({ id: "s", title: "Sibling", published_url: post("s") }),
      ],
      SITE,
    );
    expect(out).toEqual([`Sibling: ${post("s")}`, `Pillar post: ${post("p")}`]);
  });

  it("skips the topic itself, unpublished rows, and URLs off the brand's site", () => {
    const out = buildInternalLinkTargets(
      topic,
      [
        candidate({ id: "t-1" }),
        candidate({ id: "a", published_url: null }),
        candidate({ id: "b", published_url: "https://www.sanity.io/manage/project/abc" }),
        candidate({ id: "c", published_url: "https://dashboard.mailerlite.com/campaigns/123" }),
      ],
      SITE,
    );
    expect(out).toEqual([]);
  });

  it("treats www and the apex as the same site", () => {
    const out = buildInternalLinkTargets(
      topic,
      [candidate({ id: "w", title: "Www", published_url: "https://www.moguldesignagency.com/blog/w" })],
      "moguldesignagency.com",
    );
    expect(out).toEqual(["Www: https://www.moguldesignagency.com/blog/w"]);
  });

  it("adds nothing when the brand has no website set", () => {
    expect(buildInternalLinkTargets(topic, [candidate({ id: "s" })], undefined)).toEqual([]);
  });

  it("keeps stored targets first and never repeats their URL", () => {
    const out = buildInternalLinkTargets(
      { ...topic, internal_link_targets: [`Guide: ${post("s")}`] },
      [candidate({ id: "s", published_url: post("s") })],
      SITE,
    );
    expect(out).toEqual([`Guide: ${post("s")}`]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      candidate({ id: `n${i}`, published_url: post(String(i)) }),
    );
    expect(buildInternalLinkTargets(topic, many, SITE)).toHaveLength(MAX_INTERNAL_LINKS);
  });
});
