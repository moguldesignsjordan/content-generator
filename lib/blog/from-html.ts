// Rendered blog HTML → markdown. The inverse of the markdownToPortableText →
// @portabletext/to-html path in render-preview.ts.
//
// Why this exists: a blog article is STORED as markdown (meta.blog_copy) but
// SHOWN rendered. Inline editing means the user types on the rendered article,
// so what comes back is HTML and it has to become markdown again before it is
// saved — otherwise the next Sanity publish would get HTML where it expects
// markdown, and every bold/link/bullet the user typed would be lost.
//
// The subset is small and closed, because we own both ends: to-portable-text.ts
// only ever produces #..#### headings, paragraphs, -/1. lists, > quotes,
// **bold**, *italic*, `code` and [text](url), and to-html renders exactly those
// as h1-h4 / p / ul-ol-li / blockquote / strong / em / code / a. So this
// handles precisely that, plus the <div>/<b>/<i> that contentEditable adds.
//
// The guarantee is enforced by a round-trip test (from-html.test.ts):
// htmlToMarkdown(toHTML(markdownToPortableText(md))) === md, for a corpus of
// representative posts. That test is what makes inline blog editing safe to
// ship; if you extend the markdown subset, extend it here and there together.
//
// Deliberately NOT server-only: pure transform, no secrets, imported by vitest.

import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";

/** Characters that would be read back as markdown syntax if left bare in text. */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

/** Renders a node's children as a single line of inline markdown. */
function inline($: ReturnType<typeof load>, nodes: AnyNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += escapeMarkdown(node.data);
      continue;
    }
    if (node.type !== "tag") continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const inner = inline($, el.children);

    switch (tag) {
      case "strong":
      case "b":
        // Empty emphasis would round-trip to a literal "****".
        out += inner.trim() ? `**${inner}**` : inner;
        break;
      case "em":
      case "i":
        out += inner.trim() ? `*${inner}*` : inner;
        break;
      case "code":
        // Code spans are literal: the escaping applied to their text has to come back off.
        out += `\`${inner.replace(/\\([\\`*_[\]])/g, "$1")}\``;
        break;
      case "a": {
        const href = el.attribs?.href ?? "";
        out += href ? `[${inner}](${href})` : inner;
        break;
      }
      case "br":
        out += "\n";
        break;
      default:
        // u / span / anything else the user's browser invented: keep the text.
        out += inner;
    }
  }
  return out;
}

/** Collapses the whitespace HTML rendering treats as insignificant. */
function tidy(line: string): string {
  return line.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
}

/**
 * Converts a fragment of rendered article HTML back into the markdown subset
 * the blog stores. Unknown block tags degrade to plain paragraphs rather than
 * leaking their markup into the copy.
 */
export function htmlToMarkdown(html: string): string {
  const $ = load(html, null, false);
  const blocks: string[] = [];

  const emit = (text: string) => {
    if (text) blocks.push(text);
  };

  const walkBlocks = (nodes: AnyNode[]): void => {
    for (const node of nodes) {
      if (node.type === "text") {
        // Bare text between blocks (contentEditable can leave it) is a paragraph.
        const text = tidy(escapeMarkdown(node.data));
        emit(text);
        continue;
      }
      if (node.type !== "tag") continue;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      switch (tag) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
          emit(`${"#".repeat(Number(tag[1]))} ${tidy(inline($, el.children))}`);
          break;

        case "ul":
        case "ol": {
          const ordered = tag === "ol";
          const items = $(el)
            .children("li")
            .toArray()
            .map((li, i) => {
              const text = tidy(inline($, (li as Element).children));
              return `${ordered ? `${i + 1}.` : "-"} ${text}`;
            })
            .filter((line) => line.length > 2);
          if (items.length) emit(items.join("\n"));
          break;
        }

        case "blockquote": {
          // A blockquote may wrap a <p> (to-html doesn't, but a paste might).
          const text = tidy(inline($, el.children));
          emit(text ? `> ${text}` : "");
          break;
        }

        case "p":
        case "div":
          emit(tidy(inline($, el.children)));
          break;

        case "br":
          break;

        default:
          // A stray inline tag at block level, or a wrapper: recurse into it.
          if (el.children.some((c) => c.type === "tag" && isBlockTag((c as Element).tagName))) {
            walkBlocks(el.children);
          } else {
            emit(tidy(inline($, el.children)));
          }
      }
    }
  };

  walkBlocks($.root().children().toArray());

  return blocks.join("\n\n").trim();
}

function isBlockTag(tagName: string): boolean {
  return ["p", "div", "h1", "h2", "h3", "h4", "ul", "ol", "blockquote"].includes(
    tagName.toLowerCase(),
  );
}
