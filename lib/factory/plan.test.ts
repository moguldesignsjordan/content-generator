import { describe, expect, it } from "vitest";
import {
  addDays,
  assignDates,
  cleanPlanItems,
  pickTestItems,
  planProductSlots,
  slotCounts,
  sumPlanUsd,
  unsavedPlanProducts,
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

  it("keeps uses_reference only when it's literally true", () => {
    const [kept, dropped] = cleanPlanItems(
      [raw({ uses_reference: true }), raw({ uses_reference: "yes" })],
      opts,
    );
    expect(kept.uses_reference).toBe(true);
    expect(dropped).not.toHaveProperty("uses_reference");
  });

  it("maps a piece's photo numbers to the owner's photos, ignoring bad numbers", () => {
    const [first, second, third] = cleanPlanItems(
      [
        raw({ photos: [2, 1, 2] }),
        raw({ photos: [3] }),
        raw({ kind: "ad", format: "ad_social_proof", photos: [1.5, "1"] }),
      ],
      { ...opts, photoUrls: ["https://x/a.jpg", "https://x/b.jpg"] },
    );
    expect(first.photos).toEqual(["https://x/b.jpg", "https://x/a.jpg"]);
    expect(second).not.toHaveProperty("photos");
    expect(third).not.toHaveProperty("photos");
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

describe("planProductSlots", () => {
  it("gives every product its count, with kinds rotating across the plan", () => {
    const slots = planProductSlots(["Cards", "Hangers", "Banners"], 3, ["social", "ad", "email"]);
    expect(slots.map((s) => s.total)).toEqual([3, 3, 3]);
    for (const slot of slots) expect(slot.kinds).toEqual({ social: 1, ad: 1, email: 1, blog: 0 });
    expect(slotCounts(slots)).toEqual({ social: 3, ad: 3, email: 3, blog: 0 });
  });

  it("makes a one-kind set: one flyer each", () => {
    const slots = planProductSlots(["Cards", "Hangers", "Banners"], 1, ["social"]);
    expect(slotCounts(slots)).toEqual({ social: 3, ad: 0, email: 0, blog: 0 });
  });

  it("caps the plan at 20, spread evenly across the products", () => {
    const slots = planProductSlots(["A", "B", "C", "D"], 6, ["social", "ad"]);
    expect(slots.map((s) => s.total)).toEqual([5, 5, 5, 5]);
    const uneven = planProductSlots(["A", "B", "C"], 10, ["social"]);
    expect(uneven.map((s) => s.total)).toEqual([7, 7, 6]);
  });

  it("is empty without products or kinds", () => {
    expect(planProductSlots([], 3, ["social"])).toEqual([]);
    expect(planProductSlots(["A"], 3, [])).toEqual([]);
  });
});

describe("cleanPlanItems one product per piece", () => {
  const products = [
    { name: "Business cards", slug: "cards", max: 2 },
    { name: "Door hangers", max: 1 },
  ];
  const opts = {
    counts: { social: 3, ad: 0, email: 0, blog: 0 },
    productSlugs: new Set(["cards", "other"]),
    newId,
    products,
  };

  it("requires a listed product, caps each product, and maps a saved one to its slug", () => {
    const rows = cleanPlanItems(
      [
        raw({ product: "business cards", offer_slug: "other" }),
        raw({ product: "Yard signs" }),
        raw({}),
        raw({ product: "Door hangers" }),
        raw({ product: "Door hangers" }),
        raw({ product: "Business cards" }),
      ],
      opts,
    );
    expect(rows.map((r) => r.product)).toEqual(["Business cards", "Door hangers", "Business cards"]);
    expect(rows[0].offer_slug).toBe("cards");
    expect(rows[1].offer_slug).toBeUndefined();
  });

  it("leaves rows unchanged without products", () => {
    const rows = cleanPlanItems([raw({ product: "Business cards" })], { ...opts, products: undefined });
    expect(rows[0].product).toBeUndefined();
  });
});

describe("assignDates and pickTestItems with products", () => {
  const item = (id: string, kind: FactoryPlanItem["kind"], product: string) =>
    ({ id, kind, product }) as Omit<FactoryPlanItem, "date">;

  it("interleaves products day to day", () => {
    const dated = assignDates(
      [item("a1", "social", "A"), item("a2", "ad", "A"), item("b1", "social", "B"), item("c1", "ad", "C")],
      "2026-11-01",
      4,
    );
    expect(dated.map((i) => i.id)).toEqual(["a1", "b1", "c1", "a2"]);
  });

  it("tests three different products, different kinds where possible", () => {
    const plan = [
      item("a1", "social", "A"),
      item("a2", "ad", "A"),
      item("b1", "social", "B"),
      item("b2", "email", "B"),
      item("c1", "ad", "C"),
    ] as FactoryPlanItem[];
    expect(pickTestItems(plan).map((i) => i.id)).toEqual(["a1", "b2", "c1"]);
  });

  it("fills up to three when there are only two products", () => {
    const plan = [item("a1", "social", "A"), item("a2", "ad", "A"), item("b1", "social", "B")] as FactoryPlanItem[];
    expect(pickTestItems(plan).map((i) => i.id)).toEqual(["a1", "b1", "a2"]);
  });
});

describe("unsavedPlanProducts", () => {
  it("offers only typed products not saved yet, with the owner's photo on their pieces", () => {
    const own = "https://x.supabase.co/storage/v1/object/public/content-images/hanger.jpg";
    const factory = {
      products: [{ name: "Business cards", slug: "cards" }, { name: "Door hangers" }, { name: "Yard Signs" }, { name: "Banners" }],
      inputs: { photos: [own] },
      plan: [
        { id: "1", kind: "social", product: "Door hangers", photos: ["https://cdn.example.com/other.jpg", own] },
        { id: "2", kind: "ad", product: "Banners" },
      ] as FactoryPlanItem[],
    };
    expect(unsavedPlanProducts(factory, [{ name: "yard signs", slug: "yard-signs" }])).toEqual([
      { name: "Door hangers", photo: own },
      { name: "Banners" },
    ]);
  });
});
