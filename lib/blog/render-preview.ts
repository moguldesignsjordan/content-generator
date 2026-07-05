import { toHTML } from "@portabletext/to-html";
import type { BlogCopy, Brand, ContentImage } from "@/lib/db/types";
import { blogCopyToPortableText } from "./to-portable-text";

// Renders a blog draft as a readable article page for the review screen (and
// the downloadable preview). This is EXACTLY the Portable Text that would be
// published to Sanity, run through @portabletext/to-html, so what you review
// is what ships, wrapped in minimal typographic CSS using the brand palette.
// The optional hero image previews what publishing attaches as the Sanity
// mainImage; it renders under the title, where post layouts put it.

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

  const bodyHtml = toHTML(blogCopyToPortableText(copy));

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
    `<h1>${escapeHtml(copy.title)}</h1>`,
    `<p class="post-meta">/${escapeHtml(copy.slug)}</p>`,
    hero
      ? `<figure class="hero"><img src="${escapeHtml(hero.url)}" alt="${escapeHtml(hero.alt)}" width="${hero.width}" height="${hero.height}" /></figure>`
      : "",
    bodyHtml,
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
