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
