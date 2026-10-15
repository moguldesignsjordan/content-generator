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
    expect(r.extra.length).toBeGreaterThan(4);
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
