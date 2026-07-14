// Em-dashes are banned from all copy this engine produces (brand voice rule).
// Replace the unicode char and HTML entities with ", " so the sentence still
// reads naturally. Double-hyphen (--) is intentionally NOT replaced here because
// CSS custom properties (var(--color)) and HTML comments (<!-- -->) use it
// legitimately inside email HTML; prose ` -- ` is rare enough to skip.
export function stripEmDashes(text: string): string {
  return text
    .replace(/—/g, ", ") // — (unicode em-dash)
    .replace(/&mdash;/gi, ", ") // HTML named entity
    .replace(/&#8212;/g, ", "); // HTML numeric entity
}

/**
 * Flattens pasted email HTML to readable plain text while keeping paragraph
 * breaks (they carry the style: paragraph size is part of what the reference
 * email library is trying to learn). Plain-text input passes through nearly
 * untouched. Used when saving reference emails and chat-pasted style examples.
 */
export function emailHtmlToText(input: string): string {
  let text = input;
  if (/<[a-z][^>]*>/i.test(text)) {
    text = text
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|table|h[1-6]|li|blockquote)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"');
  }
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
