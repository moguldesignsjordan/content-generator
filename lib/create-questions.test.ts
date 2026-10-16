import { describe, expect, it } from "vitest";
import type { CampaignBrief } from "@/lib/db/types";
import {
  applyAnswers,
  checklistLines,
  cleanAsk,
  fixedChoices,
  inferSplit,
  makesCampaign,
  markAsked,
  openQuestions,
  skippedDefaults,
  splitFromWords,
} from "./create-questions";

const brief = (b: Partial<CampaignBrief>) => b as CampaignBrief;
const EM_DASH = String.fromCharCode(0x2014);

describe("openQuestions", () => {
  it("asks what's being made and what it's about when nothing is known", () => {
    expect(openQuestions(brief({}))).toEqual(["making", "about"]);
  });

  it("asks an email's open questions in priority order, three at most", () => {
    expect(openQuestions(brief({ making: "email" }))).toEqual(["about", "detail", "action"]);
    expect(openQuestions(brief({ making: "email", key_message: "Spring sale" }))).toEqual([
      "detail",
      "action",
      "example",
    ]);
  });

  it("skips what's filled", () => {
    expect(
      openQuestions(brief({ making: "email", key_message: "x", proof: "y", goal: "z" })),
    ).toEqual(["example"]);
  });

  it("asks style and photos only for kinds with pictures", () => {
    expect(openQuestions(brief({ making: "flyer", key_message: "x" }))).toEqual(["offer", "style", "photos"]);
    expect(openQuestions(brief({ making: "blog", key_message: "x" }))).toEqual(["reader", "proof", "post_type"]);
    const emailsOnly = brief({ making: "campaign", key_message: "x", channels: ["email"], products: ["cards"] });
    expect(openQuestions(emailsOnly)).not.toContain("style");
    expect(openQuestions(emailsOnly)).not.toContain("photos");
  });

  it("asks split only with 2+ products, and per product only when split is each", () => {
    const one = brief({ making: "flyer", products: ["cards"] });
    expect(openQuestions(one)).not.toContain("split");
    const two = brief({ making: "flyer", products: ["cards", "banners"] });
    expect(openQuestions(two)).toEqual(["split", "offer", "style"]);
    expect(openQuestions({ ...two, split: "each" })).toEqual(["per_product", "offer", "style"]);
    expect(openQuestions({ ...two, split: "together" })).toEqual(["offer", "style", "photos"]);
  });

  it("asks size only when the campaign isn't one per product", () => {
    const base = brief({ making: "campaign", key_message: "x", channels: ["social"], products: ["a", "b"] });
    expect(openQuestions({ ...base, split: "together" })).toContain("size");
    expect(openQuestions({ ...base, split: "each" })).not.toContain("size");
  });

  it("never asks a question again once asked", () => {
    const asked = markAsked(brief({ making: "email" }), ["about", "detail", "action"]);
    expect(openQuestions(asked)).not.toContain("detail");
    expect(openQuestions(asked)).not.toContain("action");
  });

  it("after the first round asks only structural questions", () => {
    const b = markAsked(brief({ making: "flyer", products: ["cards", "banners"] }), ["split", "offer", "style"]);
    // split was asked and unanswered; offer and style are gone; photos and
    // where never come up.
    expect(openQuestions(b)).toEqual([]);
    // A structural answer opens a new structural question.
    expect(openQuestions({ ...b, split: "each" })).toEqual(["per_product"]);
  });
});

describe("skippedDefaults", () => {
  it("is empty before any round", () => {
    expect(skippedDefaults(brief({ making: "flyer" }))).toEqual([]);
  });

  it("names a default for everything unanswered once a round happened", () => {
    const b = markAsked(brief({ making: "flyer", key_message: "x" }), ["offer", "style", "photos"]);
    expect(skippedDefaults(b).map((s) => s.id)).toEqual(["offer", "style", "photos", "where"]);
    expect(skippedDefaults(b).find((s) => s.id === "where")?.fallback).toBe("a square post");
  });

  it("drops what they answered", () => {
    const b = markAsked(brief({ making: "flyer", key_message: "x", offer_deal: "20% off" }), ["offer"]);
    expect(skippedDefaults(b).map((s) => s.id)).not.toContain("offer");
  });
});

describe("splitFromWords", () => {
  it("reads each from product-campaign wording", () => {
    expect(splitFromWords("a print campaign for cards, door hangers, banners")).toBe("each");
    expect(splitFromWords("one flyer for each product")).toBe("each");
    expect(splitFromWords("separate designs please")).toBe("each");
    expect(splitFromWords("showcase our whole print lineup")).toBe("each");
  });

  it("reads together from bundle wording, but not from 'put together'", () => {
    expect(splitFromWords("a bundle of cards and banners")).toBe("together");
    expect(splitFromWords("all of them together on one flyer")).toBe("together");
    expect(splitFromWords("put together a campaign for cards and banners")).toBeNull();
  });

  it("asks when the words say both or neither", () => {
    expect(splitFromWords("flyers for cards and banners")).toBeNull();
    expect(splitFromWords("a print campaign with a bundle deal")).toBeNull();
  });
});

describe("inferSplit", () => {
  it("applies only with 2+ products and no split yet", () => {
    const text = "a product campaign";
    expect(inferSplit(brief({ products: ["a"] }), text).split).toBeUndefined();
    expect(inferSplit(brief({ products: ["a", "b"] }), text).split).toBe("each");
    expect(inferSplit(brief({ products: ["a", "b"], split: "together" }), text).split).toBe("together");
  });
});

describe("makesCampaign", () => {
  it("is true for a campaign or a set of one kind per product", () => {
    expect(makesCampaign(brief({ making: "campaign" }))).toBe(true);
    expect(makesCampaign(brief({ making: "flyer", products: ["a", "b"], split: "each" }))).toBe(true);
    expect(makesCampaign(brief({ making: "flyer", products: ["a", "b"], split: "together" }))).toBe(false);
    expect(makesCampaign(brief({ making: "email" }))).toBe(false);
  });
});

describe("fixedChoices", () => {
  it("owns the structural choices", () => {
    expect(fixedChoices("channels", brief({}), [])?.choices.map((c) => c.label)).toEqual([
      "Posts",
      "Ads",
      "Emails",
      "Blog",
    ]);
    expect(fixedChoices("channels", brief({}), [])?.multi).toBe(true);
    expect(fixedChoices("per_product", brief({}), [])?.choices.map((c) => c.label)).toEqual([
      "1 each (a one-off)",
      "3 each",
      "6 each",
    ]);
    expect(fixedChoices("split", brief({}), [])?.choices.map((c) => c.value)).toEqual(["each", "together"]);
  });

  it("offers mentioned and saved products, deduped", () => {
    const products = fixedChoices("products", brief({ products: ["Door hangers"] }), ["Business cards", "door hangers"]);
    expect(products?.choices.map((c) => c.label)).toEqual(["Door hangers", "Business cards"]);
    expect(products?.multi).toBe(true);
  });

  it("leaves the model's own questions to the model", () => {
    expect(fixedChoices("offer", brief({}), [])).toBeNull();
  });
});

describe("applyAnswers", () => {
  it("saves validated code-owned answers", () => {
    const next = applyAnswers(brief({}), [
      { id: "channels", values: ["social", "ad", "fax"] },
      { id: "size", values: ["6"] },
      { id: "split", values: ["each"] },
      { id: "per_product", values: ["3"] },
      { id: "products", values: ["  Business cards ", "business cards", "Banners"] },
    ]);
    expect(next).toEqual({
      channels: ["social", "ad"],
      size: 6,
      days: 14,
      split: "each",
      per_product: 3,
      products: ["Business cards", "Banners"],
    });
  });

  it("ignores junk and unknown values", () => {
    const start = brief({ split: "together" });
    expect(applyAnswers(start, "nope")).toBe(start);
    expect(
      applyAnswers(start, [{ id: "split", values: ["sideways"] }, { id: "size", values: ["7"] }, { id: "offer", values: ["20% off"] }, null]),
    ).toEqual(start);
  });
});

describe("cleanAsk", () => {
  it("shows only open questions, fills fixed choices, and marks every open id asked", () => {
    const b = brief({ making: "campaign", key_message: "Print week", products: ["Cards", "Banners"] });
    expect(openQuestions(b)).toEqual(["channels", "split", "size"]);
    const { questions, dropped, brief: next } = cleanAsk(
      {
        questions: [
          { id: "channels", question: "What should it include?", choices: ["ignored"] },
          { id: "offer", question: "Any deal?" },
          { id: "split", question: "One design each, or all together?" },
        ],
      },
      b,
      [],
    );
    expect(questions.map((q) => q.id)).toEqual(["channels", "split"]);
    expect(questions[0].choices.map((c) => c.value)).toEqual(["social", "ad", "email", "blog"]);
    expect(dropped).toEqual(["offer"]);
    // size was left out, so the model judged it answered: it counts as asked.
    expect(next.asked).toEqual(["channels", "split", "size"]);
    expect(cleanAsk({ questions: [{ id: "channels", question: "Again?" }] }, next, []).questions).toEqual([]);
  });

  it("keeps the model's choices for its own questions, capped and cleaned", () => {
    const { questions } = cleanAsk(
      { questions: [{ id: "offer", question: `Any deal${EM_DASH}or price?`, choices: ["20% off", "", "Free shipping", "a", "b", "c"], multi: true }] },
      brief({ making: "flyer", key_message: "x" }),
      [],
    );
    expect(questions).toEqual([
      {
        id: "offer",
        question: "Any deal, or price?",
        choices: ["20% off", "Free shipping", "a", "b"].map((l) => ({ label: l, value: l })),
        multi: true,
      },
    ]);
  });

  it("asks nothing and marks nothing when no question survives", () => {
    const b = brief({ making: "email", key_message: "x" });
    const out = cleanAsk({ questions: [{ id: "style", question: "Look?" }] }, b, []);
    expect(out.questions).toEqual([]);
    expect(out.brief).toBe(b);
  });
});

describe("checklistLines", () => {
  it("lists what's open, then what was asked with its default", () => {
    const b = markAsked(brief({ making: "flyer", key_message: "x", products: ["a", "b"] }), ["offer"]);
    const lines = checklistLines(b);
    expect(lines[0]).toContain("STILL OPEN");
    expect(lines[0]).toContain("split (A separate design for each product, or one with all of them?)");
    expect(lines[1]).toContain("offer: no special offer");
  });

  it("says to confirm when nothing is open", () => {
    const b = markAsked(brief({ making: "email", key_message: "x" }), ["detail", "action", "example"]);
    expect(checklistLines(b)[0]).toContain("STILL OPEN: nothing");
  });
});
