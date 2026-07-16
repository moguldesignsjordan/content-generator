import { describe, expect, it } from "vitest";
import {
  applyCtaStyleChanges,
  applyHeaderStyleChanges,
  applyStyleChanges,
  replaceCtaText,
  countRegion,
  ensureEditableRegions,
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

describe("applyCtaStyleChanges", () => {
  const CTA =
    `<div data-region="cta" style="text-align:center;margin:36px 0 8px;">` +
    `<a href="https://example.com" style="display:inline-block;background:#e2327d;color:#ffffff;font-size:16px;">Book a call</a>` +
    `</div>`;

  it("puts text/fill styling on the <a> button, not the wrapper", () => {
    const out = applyCtaStyleChanges(CTA, { background: "#0a6cff", color: "#000000" });
    const anchor = out.slice(out.indexOf("<a"));
    expect(anchor).toContain("background:#0a6cff");
    expect(anchor).toContain("color:#000000");
    // The wrapper's own style is untouched by button props.
    const wrapperTag = out.slice(0, out.indexOf(">") + 1);
    expect(wrapperTag).not.toContain("#0a6cff");
  });

  it("puts spacing and alignment on the wrapper", () => {
    const out = applyCtaStyleChanges(CTA, { textAlign: "left", margin: "12px 0" });
    const wrapperTag = out.slice(0, out.indexOf(">") + 1);
    expect(wrapperTag).toContain("text-align:left");
    expect(wrapperTag).toContain("margin:12px 0");
    // The button keeps its own styles exactly.
    expect(out).toContain(`style="display:inline-block;background:#e2327d;color:#ffffff;font-size:16px;"`);
  });

  it("splits a mixed change across both elements", () => {
    const out = applyCtaStyleChanges(CTA, { textAlign: "right", fontSize: "18px" });
    const wrapperTag = out.slice(0, out.indexOf(">") + 1);
    expect(wrapperTag).toContain("text-align:right");
    expect(wrapperTag).not.toContain("font-size");
    expect(out.slice(out.indexOf("<a"))).toContain("font-size:18px");
  });

  it("falls back to the wrapper when the region has no <a>", () => {
    const plain = `<div data-region="cta" style="text-align:center;">Call us</div>`;
    const out = applyCtaStyleChanges(plain, { color: "#123456" });
    expect(out.slice(0, out.indexOf(">") + 1)).toContain("color:#123456");
  });
});

describe("replaceCtaText", () => {
  const CTA =
    `<div data-region="cta" style="text-align:center;margin:36px 0 8px;">` +
    `<a href="https://example.com" style="display:inline-block;background:#e2327d;color:#ffffff;` +
    `padding:15px 36px;border-radius:10px;">Book a call</a>` +
    `</div>`;

  it("replaces only the label, keeping the anchor's attributes byte-identical", () => {
    const out = replaceCtaText(CTA, "Get the guide");
    expect(out).toBe(CTA.replace(">Book a call<", ">Get the guide<"));
  });

  it("escapes markup in the new label", () => {
    const out = replaceCtaText(CTA, "Save <20% & more>");
    expect(out).toContain(">Save &lt;20% &amp; more&gt;<");
    expect(out).not.toContain("<20%");
  });

  it("replaces the wrapper's content when the region has no <a>", () => {
    const plain = `<div data-region="cta" style="text-align:center;">Call us</div>`;
    const out = replaceCtaText(plain, "Email us");
    expect(out).toBe(`<div data-region="cta" style="text-align:center;">Email us</div>`);
  });

  it("returns the input unchanged when the anchor never closes", () => {
    const broken = `<div data-region="cta"><a href="#">Go`;
    expect(replaceCtaText(broken, "New")).toBe(broken);
  });
});

describe("ensureEditableRegions", () => {
  it("tags a stray sign-off paragraph above the footer as body", () => {
    const html =
      `<html><body>` +
      `<div data-region="body"><p>Main copy.</p></div>` +
      `<p style="margin:24px 0 0;">Talk soon,<br>Jordan</p>` +
      `<table data-region="footer"><tr><td>Bye</td></tr></table>` +
      `</body></html>`;
    const out = ensureEditableRegions(html);
    expect(out).toContain(`<p data-region="body" style="margin:24px 0 0;">Talk soon,`);
    // The pre-existing regions are untouched.
    expect(countRegion(out, "body")).toBe(2);
    expect(countRegion(out, "footer")).toBe(1);
  });

  it("is idempotent", () => {
    const html =
      `<html><body>` +
      `<div data-region="body"><p>Main copy.</p></div>` +
      `<p>PS: one more thing.</p>` +
      `</body></html>`;
    const once = ensureEditableRegions(html);
    expect(ensureEditableRegions(once)).toBe(once);
  });

  it("never touches text already inside a region, the head, or hidden preheaders", () => {
    const html =
      `<html><head><style>p{color:red}</style></head><body>` +
      `<div style="display:none;max-height:0;">Preview text&#847;&zwnj;</div>` +
      `<div data-region="body"><p>Inside a region.</p></div>` +
      `</body></html>`;
    expect(ensureEditableRegions(html)).toBe(html);
  });

  it("tags a leaf td holding copy, but never a structural wrapper td", () => {
    const html =
      `<html><body><table><tr>` +
      `<td><table><tr><td>Fine print the model left untagged.</td></tr></table></td>` +
      `</tr></table></body></html>`;
    const out = ensureEditableRegions(html);
    // Only the INNER td (the text leaf) is tagged.
    expect(countRegion(out, "body")).toBe(1);
    expect(out).toContain(`<td data-region="body">Fine print`);
  });

  it("skips Outlook conditional comments and empty blocks", () => {
    const html =
      `<html><body>` +
      `<!--[if mso]><table><tr><td>MSO scaffolding</td></tr></table><![endif]-->` +
      `<div>   </div>` +
      `<div data-region="body"><p>Copy.</p></div>` +
      `</body></html>`;
    expect(ensureEditableRegions(html)).toBe(html);
  });

  it("locates tagged regions by the same occurrence index the editor will use", () => {
    const html =
      `<html><body>` +
      `<div data-region="body"><p>First.</p></div>` +
      `<p>Stray second.</p>` +
      `</body></html>`;
    const out = ensureEditableRegions(html);
    const second = locateRegion(out, "body", 1);
    expect(second?.innerHTML).toBe("Stray second.");
  });
});

describe("applyHeaderStyleChanges", () => {
  const HEADER =
    `<table role="presentation" width="100%" data-region="header">` +
    `<tr><td class="em-border" style="padding:0 0 24px;">` +
    `<img src="https://x/logo.png" alt="Brand" style="display:inline-block;max-width:170px;" />` +
    `</td></tr></table>`;

  it("lands text-align on the inner td, not the table", () => {
    const out = applyHeaderStyleChanges(HEADER, { textAlign: "center" });
    const tableTag = out.slice(0, out.indexOf(">") + 1);
    expect(tableTag).not.toContain("text-align");
    const tdTag = out.slice(out.indexOf("<td"), out.indexOf(">", out.indexOf("<td")) + 1);
    expect(tdTag).toContain("text-align:center");
  });

  it("strips a legacy align attribute from the cell so it can't win in Outlook", () => {
    const legacy = HEADER.replace(`<td class="em-border"`, `<td align="left" class="em-border"`);
    const out = applyHeaderStyleChanges(legacy, { textAlign: "right" });
    expect(out).not.toContain(`align="left"`);
    expect(out).toContain("text-align:right");
  });

  it("flips a block-level logo img to inline-block so text-align can move it", () => {
    const blockLogo = HEADER.replace("display:inline-block", "display:block");
    const out = applyHeaderStyleChanges(blockLogo, { textAlign: "center" });
    expect(out).toContain("display:inline-block");
    expect(out).not.toContain("display:block");
  });

  it("applies alignment to the wrapper itself when there is no td (model-designed div header)", () => {
    const divHeader = `<div data-region="header" style="padding:0 0 24px;"><span>Brand.</span></div>`;
    const out = applyHeaderStyleChanges(divHeader, { textAlign: "center" });
    expect(out.slice(0, out.indexOf(">") + 1)).toContain("text-align:center");
  });

  it("keeps non-alignment props on the wrapper", () => {
    const out = applyHeaderStyleChanges(HEADER, { margin: "8px 0", textAlign: "left" });
    const tableTag = out.slice(0, out.indexOf(">") + 1);
    expect(tableTag).toContain("margin:8px 0");
  });
});
