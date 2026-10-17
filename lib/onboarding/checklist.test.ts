import { describe, expect, it } from "vitest";
import type { OnboardingProposal } from "@/lib/db/types";
import { answerGap, gapQuestions } from "./checklist";

const empty: OnboardingProposal = {
  name: "Acme",
  products: [],
  audience: {},
  differentiators: [],
  competitors: [],
  main_action: {},
  example_lines: [],
  guesses: [],
  sources: [],
};

describe("gapQuestions", () => {
  it("asks only the empty essentials, at most three, in order", () => {
    expect(gapQuestions(empty).map((q) => q.id)).toEqual(["products", "audience", "main_action"]);
    const filled = {
      ...empty,
      products: [{ slug: "repair", name: "Repair" }],
      audience: { label: "Homeowners" },
    };
    expect(gapQuestions(filled).map((q) => q.id)).toEqual(["main_action"]);
  });

  it("offers the six main actions as taps", () => {
    const q = gapQuestions(empty).find((g) => g.id === "main_action");
    expect(q?.choices.map((c) => c.value)).toEqual(["call", "book", "visit", "order", "quote", "message"]);
  });
});

describe("answerGap", () => {
  it("turns typed products into rows, split on commas", () => {
    const p = answerGap(empty, "products", ["Roof repair, Gutters"]);
    expect(p.products).toEqual([
      { slug: "roof-repair", name: "Roof repair" },
      { slug: "gutters", name: "Gutters" },
    ]);
  });

  it("falls back to Call when there's a phone, else the website", () => {
    expect(answerGap({ ...empty, phone: "(214) 555-0101" }, "main_action", []).main_action.kind).toBe("call");
    expect(answerGap(empty, "main_action", []).main_action.kind).toBe("visit");
  });

  it("takes a typed main action as its wording", () => {
    const p = answerGap(empty, "main_action", ["a free estimate"]);
    expect(p.main_action).toEqual({ kind: "visit", wording: "a free estimate" });
  });

  it("clears the guess tag once the owner names the audience", () => {
    const p = answerGap({ ...empty, guesses: ["audience"] }, "audience", ["Homeowners"]);
    expect(p.audience.label).toBe("Homeowners");
    expect(p.guesses).toEqual([]);
  });

  it("names a generic audience on 'you pick'", () => {
    expect(answerGap({ ...empty, service_area: "Dallas" }, "audience", []).audience.label).toBe(
      "Customers in Dallas",
    );
  });
});
