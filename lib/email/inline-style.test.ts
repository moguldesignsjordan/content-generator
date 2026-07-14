import { describe, expect, it } from "vitest";
import {
  applyStyleChanges,
  countRegion,
  guessStyleValue,
  locateRegion,
  removeRegion,
  replaceRegionInner,
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

  // Regression: the locator used to end an element at the FIRST closing tag of
  // the same name, so a region that nested its own tag (which model-designed
  // emails routinely do) was cut in half and every edit spliced into the middle
  // of the markup, corrupting the email.
  it("ends a nested region at its OWN closing tag, not the first one", () => {
    const nested =
      `<html><body>` +
      `<table data-region="header"><tr><td><table><tr><td>Logo</td></tr></table></td></tr></table>` +
      `<h1 data-region="headline">After</h1>` +
      `</body></html>`;
    const loc = locateRegion(nested, "header", 0)!;
    expect(loc.outerHTML).toBe(
      `<table data-region="header"><tr><td><table><tr><td>Logo</td></tr></table></td></tr></table>`,
    );
    expect(loc.innerHTML).toBe(`<tr><td><table><tr><td>Logo</td></tr></table></td></tr>`);
    // The region must not have swallowed what follows it.
    expect(loc.outerHTML).not.toContain("After");
  });

  it("ignores tags inside an Outlook conditional comment when counting depth", () => {
    const mso =
      `<div data-region="body"><!--[if mso]><div>ghost</div><![endif]--><p>Real.</p></div>` +
      `<h1 data-region="headline">After</h1>`;
    const loc = locateRegion(mso, "body", 0)!;
    expect(loc.outerHTML).toContain("Real.");
    expect(loc.outerHTML).not.toContain("After");
  });

  it("does not mistake a '>' inside an attribute value for the end of the tag", () => {
    const tricky = `<div data-region="body" style="font-family:'a>b'"><p>Hi.</p></div>`;
    const loc = locateRegion(tricky, "body", 0)!;
    expect(loc.innerHTML).toBe("<p>Hi.</p>");
  });
});

describe("replaceRegionInner", () => {
  // Regression: this is the case the old flatten-to-textContent + rebuild path
  // destroyed every time. Editing one word of a multi-paragraph body used to
  // collapse it into a single paragraph and escape the link and bold away.
  it("preserves sibling paragraphs, links and bold when one word changes", () => {
    const html =
      `<html><body><div data-region="body">` +
      `<p style="margin:0 0 18px;">First with a <a href="https://example.com">link</a>.</p>` +
      `<p style="margin:0 0 18px;">Second with <strong>bold</strong>.</p>` +
      `</div></body></html>`;
    // What contentEditable hands back after the user edits "Second" → "Edited".
    const edited =
      `<p style="margin:0 0 18px;">First with a <a href="https://example.com">link</a>.</p>` +
      `<p style="margin:0 0 18px;">Edited with <strong>bold</strong>.</p>`;

    const result = replaceRegionInner(html, "body", 0, edited);
    expect(result).not.toHaveProperty("error");
    const next = (result as { html: string }).html;

    expect(next).toContain('<a href="https://example.com">link</a>');
    expect(next).toContain("<strong>bold</strong>");
    expect(next).toContain("Edited with");
    expect(next.match(/<p /g)).toHaveLength(2);
  });

  it("leaves every byte outside the region untouched", () => {
    const before = TAGGED.slice(0, locateRegion(TAGGED, "headline", 0)!.start);
    const after = TAGGED.slice(locateRegion(TAGGED, "headline", 0)!.end);
    const next = (replaceRegionInner(TAGGED, "headline", 0, "New idea") as { html: string }).html;
    expect(next.startsWith(before)).toBe(true);
    expect(next.endsWith(after)).toBe(true);
    expect(next).toContain(
      `<h1 data-region="headline" style="font-size:32px;color:#111;">New idea</h1>`,
    );
  });

  it("edits the right one of two repeated regions", () => {
    const next = (replaceRegionInner(TAGGED, "body", 1, "<p>Changed.</p>") as { html: string })
      .html;
    expect(next).toContain("First.");
    expect(next).toContain("Changed.");
    expect(next).not.toContain("Second.");
  });

  it("reports an error for a region that isn't there", () => {
    expect(replaceRegionInner(TAGGED, "body", 9, "<p>x</p>")).toHaveProperty("error");
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
