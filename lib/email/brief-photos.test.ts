import { describe, expect, it } from "vitest";
import { MAX_BRIEF_PHOTOS, ensureBriefPhotos } from "./brief-photos";

// Same representative fixtures as hero-image.test.ts: a div-tagged document,
// and the real table-per-region shape generated emails actually use.
const TAGGED =
  `<html><body>` +
  `<h1 data-region="headline">Big idea</h1>` +
  `<div data-region="body"><p>Copy.</p></div>` +
  `<div data-region="cta"><a href="#">Go</a></div>` +
  `<table data-region="footer"><tr><td>Bye</td></tr></table>` +
  `</body></html>`;

const TAGGED_TABLE =
  `<html><body><table>` +
  `<tr><td data-region="headline"><h1>Big idea</h1></td></tr>` +
  `<tr><td data-region="body"><p>Copy.</p></td></tr>` +
  `<tr><td data-region="cta"><a href="#">Go</a></td></tr>` +
  `<tr><td data-region="footer">Bye</td></tr>` +
  `</table></body></html>`;

const P1 = "https://cdn.example.com/one.jpg";
const P2 = "https://cdn.example.com/two.jpg";

describe("ensureBriefPhotos", () => {
  it("returns the html unchanged with no photos", () => {
    expect(ensureBriefPhotos(TAGGED, undefined)).toBe(TAGGED);
    expect(ensureBriefPhotos(TAGGED, [])).toBe(TAGGED);
  });

  it("splices missing photos before the CTA, in order", () => {
    const out = ensureBriefPhotos(TAGGED, [P1, P2]);
    const cta = out.indexOf('data-region="cta"');
    expect(out.indexOf(P1)).toBeGreaterThan(-1);
    expect(out.indexOf(P1)).toBeLessThan(out.indexOf(P2));
    expect(out.indexOf(P2)).toBeLessThan(cta);
  });

  it("inserts whole <tr> rows in table documents (no foster parenting)", () => {
    const out = ensureBriefPhotos(TAGGED_TABLE, [P1]);
    expect(out).toContain(`<tr><td data-region="photo"`);
    // The photo row sits before the CTA row, inside the table.
    expect(out.indexOf(P1)).toBeLessThan(out.indexOf('data-region="cta"'));
    expect(out.indexOf("<table>")).toBeLessThan(out.indexOf(P1));
  });

  it("leaves photos the model already placed exactly where they are", () => {
    const placed =
      `<html><body>` +
      `<h1 data-region="headline">Big idea</h1>` +
      `<div data-region="body"><img src="${P1}" alt="team" /></div>` +
      `<div data-region="cta"><a href="#">Go</a></div>` +
      `</body></html>`;
    const out = ensureBriefPhotos(placed, [P1, P2]);
    // P1 untouched (still exactly once, in the body), only P2 spliced.
    expect(out.split(P1).length - 1).toBe(1);
    expect(out).toContain(P2);
  });

  it("is idempotent", () => {
    const once = ensureBriefPhotos(TAGGED, [P1, P2]);
    expect(ensureBriefPhotos(once, [P1, P2])).toBe(once);
  });

  it("detects an already-placed photo whose URL was attribute-escaped", () => {
    const amp = "https://cdn.example.com/pic.jpg?w=600&h=400";
    const placed = `<html><body><img src="${amp.replace(/&/g, "&amp;")}" alt="" /><div data-region="cta">Go</div></body></html>`;
    const out = ensureBriefPhotos(placed, [amp]);
    expect(out).toBe(placed);
  });

  it("escapes the URL it splices", () => {
    const amp = "https://cdn.example.com/pic.jpg?w=600&h=400";
    const out = ensureBriefPhotos(TAGGED, [amp]);
    expect(out).toContain("pic.jpg?w=600&amp;h=400");
  });

  it("falls back to before the footer, then </body>, then appending", () => {
    const noCta = `<html><body><p>Hi</p><table data-region="footer"><tr><td>Bye</td></tr></table></body></html>`;
    const viaFooter = ensureBriefPhotos(noCta, [P1]);
    expect(viaFooter.indexOf(P1)).toBeLessThan(viaFooter.indexOf('data-region="footer"'));

    const bare = `<html><body><p>Hi</p></body></html>`;
    const viaBody = ensureBriefPhotos(bare, [P1]);
    expect(viaBody.indexOf(P1)).toBeLessThan(viaBody.indexOf("</body>"));

    const fragment = `<p>Hi</p>`;
    expect(ensureBriefPhotos(fragment, [P1])).toContain(P1);
  });

  it("caps at MAX_BRIEF_PHOTOS", () => {
    const urls = Array.from(
      { length: MAX_BRIEF_PHOTOS + 3 },
      (_, i) => `https://cdn.example.com/p${i}.jpg`,
    );
    const out = ensureBriefPhotos(TAGGED, urls);
    expect(out).toContain(`p${MAX_BRIEF_PHOTOS - 1}.jpg`);
    expect(out).not.toContain(`p${MAX_BRIEF_PHOTOS}.jpg`);
  });

  it("never uses the hero's data-region so removeHeroImage can't eat a photo", () => {
    const out = ensureBriefPhotos(TAGGED, [P1]);
    expect(out).not.toContain('data-region="image"');
    expect(out).toContain('data-region="photo"');
  });
});
