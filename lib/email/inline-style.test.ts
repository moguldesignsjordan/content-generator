import { describe, expect, it } from "vitest";
import {
  applyStyleChanges,
  countRegion,
  guessStyleValue,
  locateRegion,
  removeRegion,
  replaceRegionText,
} from "./inline-style";

// A representative tagged email with a repeated "body" region (two step
// paragraphs), mirroring what newsletter-howto.ts actually renders.
const TAGGED =
  `<html><body>` +
  `<table data-region="header"><tr><td>Logo</td></tr></table>` +
  `<div data-region="eyebrow" style="font-size:12px;font-weight:700;">QUICK TIP</div>` +
  `<h1 data-region="headline" style="font-size:32px;color:#111;">Big idea</h1>` +
  `<div data-region="body"><p style="margin:0 0 18px;font-size:16px;line-height:1.65;">First.</p></div>` +
  `<div data-region="body"><p style="margin:0 0 18px;font-size:16px;line-height:1.65;">Second.</p></div>` +
  `<div data-region="cta" style="text-align:center;"><a href="#" style="color:#fff;">Go</a></div>` +
  `<table data-region="footer"><tr><td>Bye</td></tr></table>` +
  `</body></html>`;

describe("locateRegion", () => {
  it("finds the first occurrence by default", () => {
    const loc = locateRegion(TAGGED, "headline", 0);
    expect(loc?.outerHTML).toBe(
      `<h1 data-region="headline" style="font-size:32px;color:#111;">Big idea</h1>`,
    );
  });

  it("disambiguates repeated regions by occurrence index", () => {
    const first = locateRegion(TAGGED, "body", 0);
    const second = locateRegion(TAGGED, "body", 1);
    expect(first?.outerHTML).toContain("First.");
    expect(second?.outerHTML).toContain("Second.");
    expect(first!.start).toBeLessThan(second!.start);
  });

  it("returns null for an occurrence that doesn't exist", () => {
    expect(locateRegion(TAGGED, "body", 2)).toBeNull();
    expect(locateRegion(TAGGED, "nonexistent", 0)).toBeNull();
  });

  it("returned offsets slice back to the exact outerHTML", () => {
    const loc = locateRegion(TAGGED, "cta", 0)!;
    expect(TAGGED.slice(loc.start, loc.end)).toBe(loc.outerHTML);
  });
});

describe("applyStyleChanges", () => {
  it("adds a style attribute when none exists", () => {
    const out = applyStyleChanges(`<div data-region="x">hi</div>`, { color: "#f00" });
    expect(out).toBe(`<div data-region="x" style="color:#f00;">hi</div>`);
  });

  it("adds a new property alongside existing ones", () => {
    const out = applyStyleChanges(
      `<h1 style="font-size:32px;color:#111;">Big idea</h1>`,
      { fontWeight: "700" },
    );
    expect(out).toContain("font-size:32px");
    expect(out).toContain("color:#111");
    expect(out).toContain("font-weight:700");
  });

  it("replaces an existing property in place rather than duplicating it", () => {
    const out = applyStyleChanges(`<h1 style="color:#111;">hi</h1>`, { color: "#0f0" });
    expect(out.match(/color:/g)).toHaveLength(1);
    expect(out).toContain("color:#0f0");
  });

  it("clears background-color when background is set, so they can't disagree", () => {
    const out = applyStyleChanges(
      `<div style="background-color:#111;">hi</div>`,
      { background: "#eee" },
    );
    expect(out).not.toContain("background-color");
    expect(out).toContain("background:#eee");
  });

  it("leaves inner HTML and other attributes untouched", () => {
    const out = applyStyleChanges(
      `<div data-region="cta" style="text-align:center;"><a href="#">Go</a></div>`,
      { textAlign: "right" },
    );
    expect(out).toBe(
      `<div data-region="cta" style="text-align:right;"><a href="#">Go</a></div>`,
    );
  });
});

describe("guessStyleValue", () => {
  it("reads an existing property, best-effort", () => {
    expect(guessStyleValue(`<h1 style="font-size:32px;color:#111;">x</h1>`, "fontSize")).toBe(
      "32px",
    );
  });

  it("returns undefined when the property or style attr is absent", () => {
    expect(guessStyleValue(`<h1 style="color:#111;">x</h1>`, "fontSize")).toBeUndefined();
    expect(guessStyleValue(`<h1>x</h1>`, "color")).toBeUndefined();
  });
});

describe("replaceRegionText", () => {
  it("swaps a simple single-text-node region wholesale (headline)", () => {
    const loc = locateRegion(TAGGED, "headline", 0)!;
    const out = replaceRegionText(loc.outerHTML, "headline", "New idea");
    expect(out).toBe(`<h1 data-region="headline" style="font-size:32px;color:#111;">New idea</h1>`);
  });

  it("escapes text in a simple region swap", () => {
    const loc = locateRegion(TAGGED, "eyebrow", 0)!;
    const out = replaceRegionText(loc.outerHTML, "eyebrow", "A & B");
    expect(out).toContain("A &amp; B");
  });

  it("re-paragraphs a body region on blank lines, reusing the existing <p> style", () => {
    const loc = locateRegion(TAGGED, "body", 0)!;
    const out = replaceRegionText(loc.outerHTML, "body", "Para one.\n\nPara two.");
    expect(out).toBe(
      `<div data-region="body">` +
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;">Para one.</p>` +
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;">Para two.</p>` +
        `</div>`,
    );
  });

  it("swaps only the anchor's text in a cta region, preserving href/style", () => {
    const loc = locateRegion(TAGGED, "cta", 0)!;
    const out = replaceRegionText(loc.outerHTML, "cta", "Get started");
    expect(out).toBe(
      `<div data-region="cta" style="text-align:center;"><a href="#" style="color:#fff;">Get started</a></div>`,
    );
  });

  it("fails safe (returns null) for structurally complex regions it doesn't special-case", () => {
    const loc = locateRegion(TAGGED, "footer", 0)!;
    expect(replaceRegionText(loc.outerHTML, "footer", "New footer")).toBeNull();
  });

  it("returns null for an empty replacement in a body region", () => {
    const loc = locateRegion(TAGGED, "body", 0)!;
    expect(replaceRegionText(loc.outerHTML, "body", "   \n\n  ")).toBeNull();
  });
});

describe("countRegion", () => {
  it("counts repeated occurrences", () => {
    expect(countRegion(TAGGED, "body")).toBe(2);
    expect(countRegion(TAGGED, "headline")).toBe(1);
  });

  it("returns 0 for a region that isn't present", () => {
    expect(countRegion(TAGGED, "nonexistent")).toBe(0);
  });
});

describe("removeRegion", () => {
  it("removes the targeted occurrence and leaves the rest intact", () => {
    const res = removeRegion(TAGGED, "body", 1);
    expect("html" in res).toBe(true);
    if ("html" in res) {
      expect(res.html).not.toContain("Second.");
      expect(res.html).toContain("First.");
      expect(countRegion(res.html, "body")).toBe(1);
    }
  });

  it("can remove a single-occurrence content region like eyebrow", () => {
    const res = removeRegion(TAGGED, "eyebrow", 0);
    expect("html" in res).toBe(true);
    if ("html" in res) {
      expect(res.html).not.toContain("QUICK TIP");
      expect(countRegion(res.html, "eyebrow")).toBe(0);
    }
  });

  it("errors when the occurrence index doesn't exist", () => {
    const res = removeRegion(TAGGED, "body", 9);
    expect("error" in res).toBe(true);
  });
});
