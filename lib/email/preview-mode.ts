export type EmailPreviewMode = "auto" | "light" | "dark";

// A fresh RegExp per call, deliberately: a shared `g`-flagged instance would
// carry `lastIndex` state across calls (and across these two functions),
// making repeated `.test()` calls flip true/false/true on the exact same
// input depending on prior calls. Reconstructing it is cheap at this size.
const DARK_MEDIA_SOURCE = String.raw`@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)`;

/**
 * Forces how an email's dark-mode CSS evaluates, for preview/export only.
 * "auto" is the identity (the real adaptive email, untouched) — the media
 * condition is only rewritten so the forced state renders, never the region
 * markup, so this is safe to apply purely at render/export time.
 */
export function forceColorScheme(html: string, mode: EmailPreviewMode): string {
  if (mode === "auto") return html;
  return html.replace(
    new RegExp(DARK_MEDIA_SOURCE, "gi"),
    mode === "dark" ? "@media screen" : "@media (min-width: 100000px)",
  );
}

/**
 * Whether this draft's HTML actually carries dark-mode CSS to force. Older
 * drafts, and any model-authored draft that skipped the prompt's dark-mode
 * instruction, have no such block, so forcing light/dark would be a silent
 * no-op — the editor should disable the toggle for these instead of pretending
 * it works.
 */
export function hasDarkModeSupport(html: string): boolean {
  return new RegExp(DARK_MEDIA_SOURCE, "i").test(html);
}
