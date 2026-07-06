import { describe, expect, it } from "vitest";
import {
  removeHeroImage,
  renderHeroImageBlock,
  spliceHeroImage,
} from "./hero-image";
import type { ContentImage, HeroPlacement } from "@/lib/db/types";

function img(placement?: HeroPlacement): ContentImage {
  return {
    url: "https://cdn.example.com/hero.jpg",
    alt: 'A desk with a laptop & "coffee"',
    width: 1200,
    height: 675,
    style: "illustration",
    ...(placement ? { placement } : {}),
  };
}

// A representative tagged email in region order: header → eyebrow →
// headline → body → cta → footer.
const TAGGED =
  `<html><body>` +
  `<table data-region="header"><tr><td>Logo</td></tr></table>` +
  `<div data-region="eyebrow">QUICK TIP</div>` +
  `<h1 data-region="headline">Big idea</h1>` +
  `<div data-region="body"><p>Copy.</p></div>` +
  `<div data-region="cta"><a href="#">Go</a></div>` +
  `<table data-region="footer"><tr><td>Bye</td></tr></table>` +
  `</body></html>`;

const UNTAGGED =
  `<html><body><h2>kicker</h2><h1>Untagged headline</h1><p>Copy.</p></body></html>`;

// The real shape every generated email actually uses: each region is a <td>
// in its own <tr>, nested inside a <table> "card". This is what caught the
// foster-parenting bug the div-only TAGGED fixture above could never catch.
const TAGGED_TABLE =
  `<html><body><table>` +
  `<tr><td data-region="header">Logo</td></tr>` +
  `<tr><td data-region="eyebrow">QUICK TIP</td></tr>` +
  `<tr><td data-region="headline"><h1>Big idea</h1></td></tr>` +
  `<tr><td data-region="body"><p>Copy.</p></td></tr>` +
  `<tr><td data-region="cta"><a href="#">Go</a></td></tr>` +
  `<tr><td data-region="footer">Bye</td></tr>` +
  `</table></body></html>`;

/** Index of the hero block in `html`, for ordering assertions. */
function heroAt(html: string): number {
  return html.indexOf('data-region="image"');
}

describe("renderHeroImageBlock", () => {
  it("escapes url and alt", () => {
    const block = renderHeroImageBlock(img());
    expect(block).toContain("alt=\"A desk with a laptop &amp; &quot;coffee&quot;\"");
    expect(block).toContain('src="https://cdn.example.com/hero.jpg"');
  });
});

describe("spliceHeroImage placements", () => {
  it("top (and default) inserts before the headline element", () => {
    for (const image of [img(), img("top")]) {
      const out = spliceHeroImage(TAGGED, image)!;
      expect(out).not.toBeNull();
      expect(heroAt(out)).toBeGreaterThan(out.indexOf('data-region="eyebrow"'));
      expect(heroAt(out)).toBeLessThan(out.indexOf("<h1"));
    }
  });

  it("below_headline inserts after the headline's closing tag", () => {
    const out = spliceHeroImage(TAGGED, img("below_headline"))!;
    expect(heroAt(out)).toBeGreaterThan(out.indexOf("</h1>"));
    expect(heroAt(out)).toBeLessThan(out.indexOf('data-region="body"'));
  });

  it("above_cta inserts before the cta element, after the body", () => {
    const out = spliceHeroImage(TAGGED, img("above_cta"))!;
    expect(heroAt(out)).toBeGreaterThan(out.indexOf("</p>"));
    expect(heroAt(out)).toBeLessThan(out.indexOf('data-region="cta"'));
  });

  it("moves an existing hero instead of duplicating it", () => {
    const placed = spliceHeroImage(TAGGED, img("top"))!;
    const moved = spliceHeroImage(placed, img("above_cta"))!;
    expect(moved.match(/data-region="image"/g)).toHaveLength(1);
    expect(heroAt(moved)).toBeGreaterThan(moved.indexOf("</h1>"));
    expect(heroAt(moved)).toBeLessThan(moved.indexOf('data-region="cta"'));
  });

  it("falls back to the first <h1> in untagged documents", () => {
    const top = spliceHeroImage(UNTAGGED, img("top"))!;
    expect(heroAt(top)).toBeLessThan(top.indexOf("<h1"));
    expect(heroAt(top)).toBeGreaterThan(top.indexOf("</h2>"));

    const below = spliceHeroImage(UNTAGGED, img("below_headline"))!;
    expect(heroAt(below)).toBeGreaterThan(below.indexOf("</h1>"));
    expect(heroAt(below)).toBeLessThan(below.indexOf("<p>"));
  });

  it("above_cta degrades to below_headline when no cta region exists", () => {
    const out = spliceHeroImage(UNTAGGED, img("above_cta"))!;
    expect(heroAt(out)).toBeGreaterThan(out.indexOf("</h1>"));
  });

  it("returns null when the document has no usable anchor", () => {
    expect(spliceHeroImage("<html><body><p>Nothing.</p></body></html>", img())).toBeNull();
  });
});

describe("removeHeroImage", () => {
  it("strips the hero block and is a no-op without one", () => {
    const placed = spliceHeroImage(TAGGED, img("below_headline"))!;
    expect(removeHeroImage(placed)).toBe(TAGGED);
    expect(removeHeroImage(TAGGED)).toBe(TAGGED);
  });
});

describe("spliceHeroImage on table-based templates (real email shape)", () => {
  /** True only if the hero region is a whole <tr><td> row, never a bare
   * <div> stray-child-of-<tr> (which browsers/clients foster-parent out of
   * the table to a spot above it, regardless of the intended placement). */
  function isRowWrapped(html: string): boolean {
    const at = heroAt(html);
    const tdStart = html.lastIndexOf("<td", at);
    const trStart = html.lastIndexOf("<tr", tdStart);
    const trEnd = html.indexOf("</tr>", at);
    return (
      trStart !== -1 &&
      trEnd !== -1 &&
      html.slice(trStart, tdStart).trim() === "<tr>" &&
      !html.slice(tdStart, at).includes("</tr>")
    );
  }

  it("wraps top/below_headline/above_cta as their own row, never a bare div", () => {
    for (const placement of ["top", "below_headline", "above_cta"] as const) {
      const out = spliceHeroImage(TAGGED_TABLE, img(placement))!;
      expect(out).not.toBeNull();
      expect(isRowWrapped(out)).toBe(true);
      expect(out).not.toContain("<div data-region=\"image\"");
    }
  });

  it("below_headline lands after the headline row, before the body row", () => {
    const out = spliceHeroImage(TAGGED_TABLE, img("below_headline"))!;
    expect(heroAt(out)).toBeGreaterThan(out.indexOf("Big idea"));
    expect(heroAt(out)).toBeLessThan(out.indexOf('data-region="body"'));
  });

  it("above_cta lands after the body row, before the cta row", () => {
    const out = spliceHeroImage(TAGGED_TABLE, img("above_cta"))!;
    expect(heroAt(out)).toBeGreaterThan(out.indexOf('data-region="body"'));
    expect(heroAt(out)).toBeLessThan(out.indexOf('data-region="cta"'));
  });

  it("top lands before the headline row, after the eyebrow row", () => {
    const out = spliceHeroImage(TAGGED_TABLE, img("top"))!;
    expect(heroAt(out)).toBeGreaterThan(out.indexOf('data-region="eyebrow"'));
    expect(heroAt(out)).toBeLessThan(out.indexOf('data-region="headline"'));
  });

  it("removeHeroImage strips the whole row, no dangling empty <tr>", () => {
    const placed = spliceHeroImage(TAGGED_TABLE, img("below_headline"))!;
    expect(removeHeroImage(placed)).toBe(TAGGED_TABLE);
    expect(removeHeroImage(placed)).not.toContain("<tr></tr>");
  });

  it("moving between placements never duplicates or leaves a bare div", () => {
    const top = spliceHeroImage(TAGGED_TABLE, img("top"))!;
    const moved = spliceHeroImage(top, img("above_cta"))!;
    expect(moved.match(/data-region="image"/g)).toHaveLength(1);
    expect(isRowWrapped(moved)).toBe(true);
    expect(heroAt(moved)).toBeGreaterThan(moved.indexOf('data-region="body"'));
    expect(heroAt(moved)).toBeLessThan(moved.indexOf('data-region="cta"'));
  });
});
