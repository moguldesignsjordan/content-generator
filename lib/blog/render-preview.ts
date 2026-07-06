import { toHTML } from "@portabletext/to-html";
import type { BlogCopy, Brand, ContentImage } from "@/lib/db/types";
import { markdownToPortableText } from "./to-portable-text";

// Renders a blog draft as a readable article page for the review screen (and
// the downloadable preview). Each field is rendered into its own
// `data-field` (and, for sections, `data-index`) container so the review
// screen can turn the preview itself into the editor: it scans for these
// markers, overlays a click-to-edit hotspot on each, and edits happen right
// on the rendered article instead of a parallel form. This is otherwise
// EXACTLY the Portable Text that would be published to Sanity (see
// blogCopyToPortableText, used independently by the Sanity publish path),
// run field-by-field through @portabletext/to-html, wrapped in minimal
// typographic CSS using the brand palette. The optional hero image previews
// what publishing attaches as the Sanity mainImage; it renders under the
// title, where post layouts put it.

function renderMarkdown(text: string): string {
  return toHTML(markdownToPortableText(text));
}

export function renderBlogPreviewHtml(
  copy: BlogCopy,
  brand: Brand,
  hero?: ContentImage,
): string {
  const colors = brand.visual_identity?.colors ?? {};
  const fonts = brand.visual_identity?.fonts ?? {};
  const text = colors.text ?? "#1a202c";
  const primary = colors.primary ?? "#0f172a";
  const accent = colors.accent ?? "#2563eb";
  const heading = fonts.heading ?? "Georgia, serif";
  const body = fonts.body ?? "system-ui, -apple-system, sans-serif";

  const sectionsHtml = copy.sections
    .map(
      (section, i) =>
        `<h2 data-field="section-heading" data-index="${i}">${escapeHtml(section.heading)}</h2>` +
        `<div data-field="section-body" data-index="${i}">${renderMarkdown(section.body)}</div>`,
    )
    .join("\n");

  const ctaMarkdown = copy.cta_text
    ? copy.cta_url
      ? `[${copy.cta_text}](${copy.cta_url})`
      : `**${copy.cta_text}**`
    : "";

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light dark" />',
    `<title>${escapeHtml(copy.meta_title || copy.title)}</title>`,
    `<meta name="description" content="${escapeHtml(copy.meta_description)}" />`,
    "<style>",
    ":root { color-scheme: light dark; }",
    `body { margin: 0; background: #ffffff; color: ${text}; font-family: ${body}; line-height: 1.7; }`,
    "article { max-width: 680px; margin: 0 auto; padding: 48px 24px 80px; }",
    `h1, h2, h3 { font-family: ${heading}; color: ${primary}; line-height: 1.25; }`,
    "h1 { font-size: 34px; margin: 0 0 12px; }",
    "h2 { font-size: 24px; margin: 40px 0 12px; }",
    "p { margin: 0 0 18px; font-size: 17px; }",
    "ul, ol { margin: 0 0 18px; padding-left: 24px; }",
    "li { margin: 0 0 8px; font-size: 17px; }",
    `a { color: ${accent}; }`,
    `blockquote { margin: 0 0 18px; padding: 4px 0 4px 18px; border-left: 3px solid ${accent}; color: ${primary}; }`,
    ".post-meta { color: #64748b; font-size: 14px; margin: 0 0 32px; }",
    ".hero { margin: 0 0 32px; }",
    ".hero img { display: block; width: 100%; height: auto; border-radius: 12px; }",
    // Automatic dark mode: neutral dark surfaces, light text; the brand
    // accent stays as-is on links and blockquote rules.
    "@media (prefers-color-scheme: dark) {",
    "  body { background: #121317; color: #d9dbe0; }",
    "  h1, h2, h3 { color: #f2f3f5; }",
    "  blockquote { color: #e6e7ea; }",
    "  .post-meta { color: #8e9098; }",
    "}",
    "</style>",
    "</head>",
    "<body>",
    "<article>",
    `<h1 data-field="title">${escapeHtml(copy.title)}</h1>`,
    `<p class="post-meta" data-field="slug">/${escapeHtml(copy.slug)}</p>`,
    hero
      ? `<figure class="hero"><img src="${escapeHtml(hero.url)}" alt="${escapeHtml(hero.alt)}" width="${hero.width}" height="${hero.height}" /></figure>`
      : "",
    `<div data-field="intro">${renderMarkdown(copy.intro)}</div>`,
    sectionsHtml,
    `<div data-field="conclusion">${renderMarkdown(copy.conclusion)}</div>`,
    ctaMarkdown ? `<div data-field="cta">${renderMarkdown(ctaMarkdown)}</div>` : "",
    "</article>",
    "</body>",
    "</html>",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
