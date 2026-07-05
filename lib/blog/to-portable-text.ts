// Markdown (the constrained subset our blog prompt produces) → Portable Text.
// Hand-rolled instead of @sanity/block-tools because block-tools needs a DOM;
// this stays pure, deterministic, and unit-testable (CLAUDE.md: "convert and
// unit-test the conversion; don't write raw markdown into a rich-text field").
//
// Supported: #..#### headings, paragraphs, - / * bullet lists, 1. numbered
// lists, > blockquotes, **bold**, *italic* / _italic_, `code`,
// [text](https://url). Anything else degrades to plain text, never to raw
// markdown syntax leaking into a span.
//
// Deliberately NOT server-only: pure data transform, no secrets, imported by
// vitest.

export interface PortableTextSpan {
  _type: "span";
  _key: string;
  text: string;
  marks: string[];
}

export interface PortableTextLinkDef {
  _type: "link";
  _key: string;
  href: string;
}

export interface PortableTextBlock {
  _type: "block";
  _key: string;
  style: "normal" | "h1" | "h2" | "h3" | "h4" | "blockquote";
  listItem?: "bullet" | "number";
  level?: number;
  markDefs: PortableTextLinkDef[];
  children: PortableTextSpan[];
}

/** Deterministic per-document key generator (Sanity requires _key on arrays). */
function keyGen(): () => string {
  let n = 0;
  return () => `k${n++}`;
}

// ── Inline markdown → spans ─────────────────────────────────────────────────

interface InlineCtx {
  key: () => string;
  markDefs: PortableTextLinkDef[];
}

const INLINE_RE =
  /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(`(.+?)`)|(\[([^\]]+)\]\(([^)\s]+)\))/;

function parseInline(
  text: string,
  marks: string[],
  ctx: InlineCtx,
): PortableTextSpan[] {
  const spans: PortableTextSpan[] = [];
  let rest = text;

  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      spans.push({ _type: "span", _key: ctx.key(), text: rest, marks });
      break;
    }
    if (m.index > 0) {
      spans.push({
        _type: "span",
        _key: ctx.key(),
        text: rest.slice(0, m.index),
        marks,
      });
    }
    if (m[1]) {
      spans.push(...parseInline(m[2], [...marks, "strong"], ctx));
    } else if (m[3]) {
      spans.push(...parseInline(m[4], [...marks, "em"], ctx));
    } else if (m[5]) {
      spans.push(...parseInline(m[6], [...marks, "em"], ctx));
    } else if (m[7]) {
      spans.push({
        _type: "span",
        _key: ctx.key(),
        text: m[8],
        marks: [...marks, "code"],
      });
    } else if (m[9]) {
      const def: PortableTextLinkDef = {
        _type: "link",
        _key: ctx.key(),
        href: m[11],
      };
      ctx.markDefs.push(def);
      spans.push(...parseInline(m[10], [...marks, def._key], ctx));
    }
    rest = rest.slice(m.index + m[0].length);
  }

  return spans;
}

function makeBlock(
  text: string,
  key: () => string,
  overrides: Partial<Pick<PortableTextBlock, "style" | "listItem" | "level">> = {},
): PortableTextBlock {
  const markDefs: PortableTextLinkDef[] = [];
  const children = parseInline(text, [], { key, markDefs });
  return {
    _type: "block",
    _key: key(),
    style: overrides.style ?? "normal",
    ...(overrides.listItem ? { listItem: overrides.listItem, level: 1 } : {}),
    markDefs,
    children: children.length
      ? children
      : [{ _type: "span", _key: key(), text: "", marks: [] }],
  };
}

// ── Block-level markdown → Portable Text blocks ─────────────────────────────

export function markdownToPortableText(
  markdown: string,
  key: () => string = keyGen(),
): PortableTextBlock[] {
  const blocks: PortableTextBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  let paragraph: string[] = [];
  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push(makeBlock(text, key));
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const style = `h${heading[1].length}` as PortableTextBlock["style"];
      blocks.push(makeBlock(heading[2].trim(), key, { style }));
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      blocks.push(makeBlock(bullet[1].trim(), key, { listItem: "bullet" }));
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      blocks.push(makeBlock(numbered[1].trim(), key, { listItem: "number" }));
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      blocks.push(makeBlock(quote[1].trim(), key, { style: "blockquote" }));
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();

  return blocks;
}

// ── Whole-post assembly ──────────────────────────────────────────────────────

export interface BlogCopyLike {
  title: string;
  intro: string;
  sections: { heading: string; body: string }[];
  conclusion: string;
  cta_text: string;
  cta_url?: string;
}

/**
 * Assembles a full blog post's Portable Text body: intro, H2-per-section,
 * conclusion, and the CTA as a final linked paragraph. The title is NOT a
 * block (it maps to the Sanity document's title field, the H1 belongs to the
 * site's template).
 */
export function blogCopyToPortableText(copy: BlogCopyLike): PortableTextBlock[] {
  const key = keyGen();
  const blocks: PortableTextBlock[] = [];

  blocks.push(...markdownToPortableText(copy.intro, key));
  for (const section of copy.sections) {
    blocks.push(makeBlock(section.heading, key, { style: "h2" }));
    blocks.push(...markdownToPortableText(section.body, key));
  }
  blocks.push(...markdownToPortableText(copy.conclusion, key));

  if (copy.cta_text) {
    const cta = copy.cta_url
      ? `[${copy.cta_text}](${copy.cta_url})`
      : `**${copy.cta_text}**`;
    blocks.push(...markdownToPortableText(cta, key));
  }

  return blocks;
}
