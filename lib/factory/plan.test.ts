import { describe, expect, it } from "vitest";
import {
  addDays,
  assignDates,
  cleanPlanItems,
  pickTestItems,
  sumPlanUsd,
  type RawPlanItem,
} from "./plan";
import { splitEvenly } from "@/prompts/campaign-formats";
import type { FactoryPlanItem } from "@/lib/db/types";

// Built at runtime so this file never contains the banned character itself.
const EM_DASH = String.fromCharCode(0x2014);

let n = 0;
const newId = () => `row-${++n}`;
const counts = { social: 2, ad: 1, email: 1, blog: 0 };

function raw(over: Partial<RawPlanItem>): RawPlanItem {
  return {
    kind: "social",
    format: "offer_drop",
    title: "Title",
    hook: `Hook ${Math.random()}`,
    core_idea: `Idea ${Math.random()}`,
    key_message: "Message",
    preview: "Preview",
    needs_detail: false,
    ...over,
  };
}

describe("splitEvenly", () => {
  it("gives the remainder one at a time from the first kind", () => {
    expect(splitEvenly(7, ["social", "ad", "email"])).toEqual({
      social: 3,
      ad: 2,
      email: 2,
      blog: 0,
    });
  });

  it("splits evenly when it divides", () => {
    expect(splitEvenly(12, ["social", "ad", "email", "blog"])).toEqual({
      social: 3,
      ad: 3,
      email: 3,
      blog: 3,
    });
  });

  it("returns zeros for no kinds", () => {
    expect(splitEvenly(5, [])).toEqual({ social: 0, ad: 0, email: 0, blog: 0 });
  });
});

describe("cleanPlanItems", () => {
  const opts = { counts, productSlugs: new Set(["care-plan"]), newId };

  it("drops a repeated hook or core idea, ignoring case and punctuation", () => {
    const out = cleanPlanItems(
      [
        raw({ hook: "Your site is slow.", core_idea: "Speed sells" }),
        raw({ hook: "your site is SLOW", core_idea: "Something else" }),
        raw({ hook: "A new hook", core_idea: "speed sells!" }),
      ],
      opts,
    );
    expect(out).toHaveLength(1);
  });

  it("caps each kind at its planned count", () => {
    const out = cleanPlanItems(
      [raw({ kind: "ad", format: "ad_social_proof" }), raw({ kind: "ad", format: "ad_direct_benefit" })],
      opts,
    );
    expect(out.filter((i) => i.kind === "ad")).toHaveLength(1);
  });

  it("drops kinds that weren't asked for and rows without a title or hook", () => {
    const out = cleanPlanItems(
      [raw({ kind: "blog", format: "blog_how_to" }), raw({ title: "" }), raw({ hook: "  " })],
      opts,
    );
    expect(out).toHaveLength(0);
  });

  it("replaces a format from another kind with one of its own kind", () => {
    const [item] = cleanPlanItems([raw({ kind: "email", format: "offer_drop" })], opts);
    expect(item.format.startsWith("email_")).toBe(true);
  });

  it("strips em dashes and keeps only real product slugs", () => {
    const [a, b] = cleanPlanItems(
      [
        raw({ title: `Fast ${EM_DASH} and cheap`, offer_slug: "care-plan" }),
        raw({ offer_slug: "made-up" }),
      ],
      opts,
    );
    expect(a.title).not.toContain(EM_DASH);
    expect(a.offer_slug).toBe("care-plan");
    expect(b.offer_slug).toBeUndefined();
  });

  it("keeps the detail question only when a detail is needed", () => {
    const [a, b] = cleanPlanItems(
      [
        raw({ needs_detail: true, detail_prompt: "How many sites this year?" }),
        raw({ needs_detail: false, detail_prompt: "Ignored" }),
      ],
      opts,
    );
    expect(a.detail_prompt).toBe("How many sites this year?");
    expect(b.detail_prompt).toBeUndefined();
  });
});

describe("assignDates", () => {
  const rows = cleanPlanItems(
    [raw({}), raw({}), raw({ kind: "ad", format: "ad_social_proof" }), raw({ kind: "email", format: "email_promotional" })],
    { counts, productSlugs: new Set(), newId },
  );

  it("alternates kinds and spreads dates over the range", () => {
    const dated = assignDates(rows, "2026-11-01", 8);
    expect(dated.map((i) => i.kind)).toEqual(["social", "ad", "email", "social"]);
    expect(dated.map((i) => i.date)).toEqual([
      "2026-11-01",
      "2026-11-03",
      "2026-11-05",
      "2026-11-07",
    ]);
  });

  it("adds days across a month boundary in UTC", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("pickTestItems and sumPlanUsd", () => {
  const plan = [
    { id: "a", kind: "social" },
    { id: "b", kind: "social" },
    { id: "c", kind: "ad", draft_id: "d1" },
    { id: "d", kind: "ad" },
    { id: "e", kind: "email" },
    { id: "f", kind: "blog" },
  ] as FactoryPlanItem[];

  it("takes the first unlaunched piece of up to three kinds", () => {
    expect(pickTestItems(plan).map((i) => i.id)).toEqual(["a", "d", "e"]);
  });

  it("prices pieces at their kind's unit cost", () => {
    expect(
      sumPlanUsd(pickTestItems(plan), { social: 0.1, ad: 0.1, email: 0.25, blog: 0.25 }),
    ).toBe(0.45);
  });
});
