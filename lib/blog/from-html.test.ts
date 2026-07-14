import { describe, expect, it } from "vitest";
import { toHTML } from "@portabletext/to-html";
import { markdownToPortableText } from "./to-portable-text";
import { htmlToMarkdown } from "./from-html";

// The safety net for inline blog editing. A blog article is stored as markdown
// but edited as rendered HTML, so the conversion back has to be lossless for
// everything the blog can actually contain. If this suite passes, a user can
// type on the rendered article without silently destroying their own
// formatting on the way to Sanity.

/** The exact render path the review screen uses (render-preview.ts). */
function render(md: string): string {
  return toHTML(markdownToPortableText(md));
}

describe("htmlToMarkdown round-trip", () => {
  const corpus: Record<string, string> = {
    "a plain paragraph": "Just one plain paragraph.",
    "several paragraphs": "First paragraph.\n\nSecond paragraph.\n\nThird.",
    "bold and italic": "Some **bold** and some *italic* text.",
    "a link": "Read the [documentation](https://example.com/docs) first.",
    "inline code": "Call `npm run build` to check.",
    headings: "## A section heading\n\nBody under it.\n\n### A smaller one",
    "a bullet list": "- first item\n- second item\n- third item",
    "a numbered list": "1. first\n2. second\n3. third",
    "a blockquote": "> Something worth quoting.",
    "formatting inside a list": "- a **bold** item\n- an *italic* item\n- a [linked](https://example.com) item",
    "a full post": [
      "An intro paragraph with **weight** on the key idea.",
      "## Why it matters",
      "The reason, stated plainly with a [source](https://example.com).",
      "- it is faster\n- it is cheaper\n- it is *better*",
      "> A pull quote.",
      "1. Do this\n2. Then this",
      "A closing thought.",
    ].join("\n\n"),
  };

  for (const [name, md] of Object.entries(corpus)) {
    it(`survives ${name}`, () => {
      expect(htmlToMarkdown(render(md))).toBe(md);
    });
  }
});

describe("htmlToMarkdown contentEditable artifacts", () => {
  it("treats a browser-inserted <div> as a paragraph", () => {
    // Chrome inserts <div> when you press Enter inside a contentEditable region.
    expect(htmlToMarkdown("<p>First.</p><div>Second.</div>")).toBe("First.\n\nSecond.");
  });

  it("reads <b> and <i> (execCommand's output) as bold and italic", () => {
    // Cmd+B / Cmd+I emit the legacy tags, not <strong>/<em>.
    expect(htmlToMarkdown("<p>A <b>bold</b> and <i>italic</i> word.</p>")).toBe(
      "A **bold** and *italic* word.",
    );
  });

  it("keeps the text of a span it doesn't understand", () => {
    expect(htmlToMarkdown('<p>Keep <span style="font-weight: normal;">this</span>.</p>')).toBe(
      "Keep this.",
    );
  });

  it("escapes characters that would otherwise be read back as markup", () => {
    expect(htmlToMarkdown("<p>A literal * and a [bracket].</p>")).toBe(
      "A literal \\* and a \\[bracket\\].",
    );
  });

  it("drops an empty bold run rather than emitting ****", () => {
    expect(htmlToMarkdown("<p>Text <strong></strong>here.</p>")).toBe("Text here.");
  });
});
