import { describe, expect, it } from "vitest";
import {
  blogCopyToPortableText,
  markdownToPortableText,
  type PortableTextBlock,
} from "./to-portable-text";

/** All visible text of a block list, concatenated. */
function textOf(blocks: PortableTextBlock[]): string {
  return blocks
    .map((b) => b.children.map((c) => c.text).join(""))
    .join("\n");
}

describe("markdownToPortableText", () => {
  it("splits paragraphs on blank lines and joins soft-wrapped lines", () => {
    const blocks = markdownToPortableText(
      "First line\ncontinues here.\n\nSecond paragraph.",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].style).toBe("normal");
    expect(blocks[0].children[0].text).toBe("First line continues here.");
    expect(blocks[1].children[0].text).toBe("Second paragraph.");
  });

  it("maps # levels to heading styles", () => {
    const blocks = markdownToPortableText("# One\n## Two\n### Three");
    expect(blocks.map((b) => b.style)).toEqual(["h1", "h2", "h3"]);
    expect(blocks[1].children[0].text).toBe("Two");
  });

  it("converts bullet and numbered lists to listItem blocks", () => {
    const blocks = markdownToPortableText("- a\n- b\n\n1. one\n2. two");
    expect(blocks.map((b) => b.listItem)).toEqual([
      "bullet",
      "bullet",
      "number",
      "number",
    ]);
    expect(blocks[3].children[0].text).toBe("two");
    expect(blocks.every((b) => b.level === 1)).toBe(true);
  });

  it("parses bold, italic, and code into marked spans (no leaked syntax)", () => {
    const [block] = markdownToPortableText("A **bold** and *soft* `bit`.");
    const texts = block.children.map((c) => c.text);
    expect(texts).toEqual(["A ", "bold", " and ", "soft", " ", "bit", "."]);
    expect(block.children[1].marks).toEqual(["strong"]);
    expect(block.children[3].marks).toEqual(["em"]);
    expect(block.children[5].marks).toEqual(["code"]);
    expect(textOf([block])).not.toMatch(/[*`]/);
  });

  it("turns links into markDefs referenced by span marks", () => {
    const [block] = markdownToPortableText(
      "See [our guide](https://example.com/guide) today.",
    );
    expect(block.markDefs).toHaveLength(1);
    expect(block.markDefs[0].href).toBe("https://example.com/guide");
    const linked = block.children.find((c) => c.text === "our guide");
    expect(linked?.marks).toContain(block.markDefs[0]._key);
  });

  it("converts blockquotes", () => {
    const [block] = markdownToPortableText("> quoted wisdom");
    expect(block.style).toBe("blockquote");
    expect(block.children[0].text).toBe("quoted wisdom");
  });

  it("gives every block and span a unique _key", () => {
    const blocks = markdownToPortableText("# H\n\nPara with **bold**.\n\n- item");
    const keys = blocks.flatMap((b) => [
      b._key,
      ...b.children.map((c) => c._key),
      ...b.markDefs.map((d) => d._key),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("blogCopyToPortableText", () => {
  const copy = {
    title: "The Title",
    intro: "Welcome to the **intro**.",
    sections: [
      { heading: "First Section", body: "Body one.\n\n- point a\n- point b" },
      { heading: "Second Section", body: "Body two with [a link](https://x.co)." },
    ],
    conclusion: "Wrapping up.",
    cta_text: "Get the plan",
    cta_url: "https://example.com/plan",
  };

  it("assembles intro, h2 sections, conclusion, and a linked CTA", () => {
    const blocks = blogCopyToPortableText(copy);
    const h2s = blocks.filter((b) => b.style === "h2");
    expect(h2s.map((b) => b.children[0].text)).toEqual([
      "First Section",
      "Second Section",
    ]);
    // Title must NOT be a body block (it maps to the document's title field).
    expect(textOf(blocks)).not.toContain("The Title");
    const last = blocks[blocks.length - 1];
    expect(last.markDefs[0]?.href).toBe("https://example.com/plan");
    expect(last.children.map((c) => c.text).join("")).toBe("Get the plan");
  });

  it("never leaks raw markdown syntax into span text", () => {
    const blocks = blogCopyToPortableText(copy);
    const all = textOf(blocks);
    expect(all).not.toMatch(/\*\*|\[.*\]\(/);
  });

  it("keeps keys unique across the whole document", () => {
    const blocks = blogCopyToPortableText(copy);
    const keys = blocks.flatMap((b) => [
      b._key,
      ...b.children.map((c) => c._key),
      ...b.markDefs.map((d) => d._key),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
