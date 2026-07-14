// Sanitizes the HTML that comes back from a contentEditable region of the
// draft preview, before it is spliced into the stored email HTML (or converted
// back to markdown for a blog).
//
// Two jobs, in this order:
//
//   1. SAFETY. The fragment arrives from the browser, so it's user input:
//      strip <script>/<iframe>, every on* handler, and javascript: URLs. The
//      allowlist is closed — anything not named here is unwrapped (its text is
//      kept) or dropped.
//
//   2. TIDYING. contentEditable is a messy author. Browsers insert <div> on
//      Enter, execCommand("bold") emits <span style="font-weight: normal">
//      or <font>, and pasting drags in arbitrary classes and styles. Left
//      alone that junk accumulates in the stored email on every edit. So:
//      <div> becomes <p>, <font> and bare <span> are unwrapped, and (for the
//      email side) only a small allowlist of CSS properties survives on style.
//
// Deliberately NOT server-only: a pure string transform with no secrets, run
// on BOTH sides — the client runs it to paint the optimistic update, the
// server runs it again as the authoritative gate (never trust the client's
// sanitization). Sibling to lib/email/inline-style.ts, and imported by vitest.
//
// Cheerio is used in FRAGMENT mode only (`load(html, null, false)`). The full
// email document is never parsed or re-serialized, because doing so would risk
// rewriting the doctype and the Outlook conditional comments around it. Region
// splicing stays a byte-exact string operation (see replaceRegionInner).

import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";

/** Tags a user may end up with inside an edited region. Everything else is unwrapped. */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "a",
  "span",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "code",
]);

/** Tags whose TEXT is dropped along with them — keeping it would leak code into the copy. */
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "link"]);

/**
 * CSS properties that may survive on an edited element. Anything else (a
 * pasted `position:fixed`, a browser's `font-weight: normal` on a <span>) is
 * dropped. Kept deliberately small: the region's own styling is set by the
 * Design controls, not by whatever the browser decided to inline.
 */
const ALLOWED_CSS_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "text-align",
  "text-decoration",
  "line-height",
  "margin",
  "padding",
]);

/** A safe href: http(s), mailto, tel, an anchor, a relative path, or MailerLite's merge tag. */
function isSafeHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  // MailerLite merge tags (notably {$unsubscribe}) must survive verbatim.
  if (value.startsWith("{$") && value.endsWith("}")) return true;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return true;
  if (value.startsWith("/") || value.startsWith("#")) return true;
  // Anything with a scheme we didn't name (javascript:, data:, vbscript:) is out.
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function sanitizeStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const sep = decl.indexOf(":");
    if (sep === -1) continue;
    const prop = decl.slice(0, sep).trim().toLowerCase();
    const value = decl.slice(sep + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_CSS_PROPS.has(prop)) continue;
    // A url()/expression() in a value is never legitimate here.
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) continue;
    kept.push(`${prop}:${value}`);
  }
  return kept.join(";");
}

export interface SanitizeOptions {
  /**
   * Keep (filtered) inline `style` attributes. True for email, where the
   * template's own inline styles live on the elements being edited. False for
   * blog, where all styling comes from the renderer's stylesheet and an inline
   * style would just be dropped by the markdown conversion anyway.
   */
  allowStyle?: boolean;
}

/**
 * Cleans one edited region's inner HTML. Returns a fragment safe to splice
 * into the stored email, or to hand to htmlToMarkdown.
 */
export function sanitizeEditedFragment(
  html: string,
  { allowStyle = false }: SanitizeOptions = {},
): string {
  const $ = load(html, null, false);

  // Depth-first so that unwrapping a parent still leaves its (already cleaned)
  // children in place.
  const walk = (nodes: AnyNode[]): void => {
    for (const node of [...nodes]) {
      // domhandler gives <script> and <style> their own node types, NOT "tag",
      // so a plain `type !== "tag"` check would walk straight past them and
      // leave the script in the document.
      if (node.type === "script" || node.type === "style") {
        $(node).remove();
        continue;
      }
      if (node.type !== "tag") {
        // Comments have no business in edited copy; text nodes pass through.
        if (node.type === "comment") $(node).remove();
        continue;
      }
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      if (DROP_WITH_CONTENT.has(tag)) {
        $(el).remove();
        continue;
      }

      walk(el.children);

      // contentEditable emits <div> for a new line; the templates use <p>.
      if (tag === "div") {
        el.tagName = "p";
      } else if (tag === "font") {
        // Legacy execCommand output — keep the text, lose the tag.
        $(el).replaceWith($(el).contents());
        continue;
      } else if (!ALLOWED_TAGS.has(tag)) {
        $(el).replaceWith($(el).contents());
        continue;
      }

      const attribs = { ...el.attribs };
      el.attribs = {};
      for (const [rawName, rawValue] of Object.entries(attribs)) {
        const name = rawName.toLowerCase();
        // Event handlers, contenteditable leftovers, and our own markers never survive.
        if (name.startsWith("on")) continue;
        if (name === "contenteditable" || name === "spellcheck") continue;
        if (name === "data-region" || name === "data-field" || name === "data-index") continue;

        if (name === "href") {
          if (isSafeHref(rawValue)) el.attribs.href = rawValue.trim();
          continue;
        }
        if (name === "target" || name === "rel") {
          el.attribs[name] = rawValue;
          continue;
        }
        if (name === "style" && allowStyle) {
          const style = sanitizeStyle(rawValue);
          if (style) el.attribs.style = style;
          continue;
        }
        // Everything else (class, id, pasted data-*, width, align…) is dropped.
      }

      // An <a> that lost its href to the safety check is no longer a link.
      if (el.tagName.toLowerCase() === "a" && !el.attribs.href) {
        $(el).replaceWith($(el).contents());
        continue;
      }

      // A <span> carrying nothing useful is pure contentEditable noise.
      if (el.tagName.toLowerCase() === "span" && Object.keys(el.attribs).length === 0) {
        $(el).replaceWith($(el).contents());
      }
    }
  };

  walk($.root().children().toArray());

  return $.html().replace(/&nbsp;/g, " ").trim();
}
