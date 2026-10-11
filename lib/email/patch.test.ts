import { describe, expect, it } from "vitest";
import { applyCopyPatches } from "./patch";
import type { EmailCopy } from "@/lib/db/types";

const COPY: EmailCopy = {
  subject: "Your site isn't just slow, it's costing you",
  preheader: "A faster site in two weeks.",
  headline: "Speed sells.",
  body_sections: [
    { heading: "Why it matters", body: "Patience is gone, not just taste. Visitors leave fast." },
    { body: "Built to convert, not just exist." },
  ],
  cta_text: "Book a call",
};

// Templates escape copy into the HTML, so the apostrophe shows up as &#39;.
const HTML =
  `<title>Your site isn't just slow</title>` +
  `<div class="em-text">Patience is gone, not just taste. Visitors leave fast.</div>` +
  `<div class="em-text">Built to convert, not just exist.</div>`;

describe("applyCopyPatches", () => {
  it("patches the copy and the HTML together", () => {
    const out = applyCopyPatches(COPY, HTML, [
      { find: "Patience is gone, not just taste.", replace: "Visitors have no patience left." },
    ]);
    expect(out.applied).toHaveLength(1);
    expect(out.copy.body_sections[0].body).toBe("Visitors have no patience left. Visitors leave fast.");
    expect(out.html).toContain("Visitors have no patience left. Visitors leave fast.");
    expect(COPY.body_sections[0].body).toContain("not just taste");
  });

  it("matches copy that the template escaped into the HTML", () => {
    const html = `<div>Don&#39;t settle, it&#39;s not just a site.</div>`;
    const copy = { ...COPY, body_sections: [{ body: "Don't settle, it's not just a site." }] };
    const out = applyCopyPatches(copy, html, [
      { find: "Don't settle, it's not just a site.", replace: "Don't settle for a site that sits there." },
    ]);
    expect(out.html).toBe(`<div>Don&#39;t settle for a site that sits there.</div>`);
  });

  it("patches a subject line that never appears in the HTML", () => {
    const out = applyCopyPatches(COPY, "<div>body</div>", [
      { find: "Your site isn't just slow, it's costing you", replace: "Your slow site is costing you" },
    ]);
    expect(out.copy.subject).toBe("Your slow site is costing you");
    expect(out.html).toBe("<div>body</div>");
  });

  it("skips a patch it can't place, keeping the ones it can", () => {
    const out = applyCopyPatches(COPY, HTML, [
      { find: "A sentence the model paraphrased.", replace: "x" },
      { find: "Built to convert, not just exist.", replace: "Built to convert." },
    ]);
    expect(out.applied.map((e) => e.replace)).toEqual(["Built to convert."]);
    expect(out.copy.body_sections[1].body).toBe("Built to convert.");
  });

  it("rejects ambiguous finds and replacements carrying markup", () => {
    const out = applyCopyPatches(COPY, HTML, [
      { find: "not just", replace: "more than" },
      { find: "Built to convert, not just exist.", replace: "<b>Built</b> to convert." },
    ]);
    expect(out.applied).toHaveLength(0);
    expect(out.html).toBe(HTML);
  });
});
