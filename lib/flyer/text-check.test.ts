import { describe, expect, it } from "vitest";
import { checkRenderedText } from "./text-check";

const expected = ["48 hours. Perfect prints.", "No waiting, no excuses.", "Claim your slot"];

describe("checkRenderedText", () => {
  it("passes when every line is there, ignoring case and punctuation", () => {
    const seen = "48 HOURS PERFECT PRINTS\nNo waiting no excuses\nCLAIM YOUR SLOT";
    expect(checkRenderedText(expected, seen).ok).toBe(true);
  });

  it("fails on a misspelling and names the line", () => {
    const r = checkRenderedText(expected, "48 hours. Perfect prnts.\nNo waiting, no excuses.\nClaim your slot");
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["48 hours. Perfect prints."]);
  });

  it("fails when a line is missing entirely", () => {
    const r = checkRenderedText(expected, "48 hours. Perfect prints.\nClaim your slot");
    expect(r.missing).toEqual(["No waiting, no excuses."]);
  });

  it("allows a few stray words (a product's own label) but not a paragraph", () => {
    const base = expected.join("\n");
    expect(checkRenderedText(expected, `${base}\nACME PRO`).ok).toBe(true);
    const r = checkRenderedText(expected, `${base}\nshop the summer sale today with free shipping on every order`);
    expect(r.ok).toBe(false);
    expect(r.extra.length).toBeGreaterThan(8);
  });

  it("counts a label repeated across a mockup's items once", () => {
    const seen = `${expected.join("\n")}\n${"DAILY GRIND COFFEE\n".repeat(4)}`;
    const r = checkRenderedText(expected, seen);
    expect(r.ok).toBe(true);
    expect(r.extra).toEqual(["daily", "grind", "coffee"]);
  });

  it("passes sample text the model put on a showcased product", () => {
    const seen = `${expected.join("\n")}\nIMPACT SIGN CO\n555-0199`;
    expect(checkRenderedText(expected, seen).ok).toBe(true);
  });

  const examples = "yard sign design\nAXE-TRA BOLD\nFEARLESS ROOFING\n570-212-ROOF\nSERVING NORTHEASTERN PENNSYLVANIA";

  it("fails when the design repeats the examples' own words", () => {
    const seen = `${expected.join("\n")}\nFearless Roofing\n570-212-ROOF`;
    const r = checkRenderedText(expected, seen, [], examples);
    expect(r.ok).toBe(false);
    expect(r.copied).toContain("fearless roofing");
    expect(r.copied).toContain("570 212");
  });

  it("doesn't call a shared common word copying", () => {
    const seen = `${expected.join("\n")}\nImpact Sign Co`;
    expect(checkRenderedText(expected, seen, [], examples).ok).toBe(true);
  });

  it("doesn't flag an example phrase that our own copy uses", () => {
    const ours = ["Yard sign design that sells"];
    expect(checkRenderedText(ours, "YARD SIGN DESIGN THAT SELLS", [], examples).ok).toBe(true);
  });

  it("treats apostrophes and dollar signs sensibly", () => {
    expect(checkRenderedText(["Don't wait: $49"], "DONT WAIT $49").ok).toBe(true);
  });

  it("doesn't count a client's logo name as stray text", () => {
    const base = expected.join("\n");
    const seen = `${base}\nthe tax moguls www thetaxmoguls com rated best`;
    expect(checkRenderedText(expected, seen).extra).toContain("moguls");
    expect(checkRenderedText(expected, seen, ["The Tax Moguls"]).extra).not.toContain("moguls");
  });
});
