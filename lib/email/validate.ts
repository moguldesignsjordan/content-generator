/**
 * Safety gates for model-authored email HTML.
 *
 * These live in a leaf module (no pipeline imports) because three different
 * pipelines need them: fresh generation, the edit/redesign flows in
 * lib/pipeline/html-edit.ts, and the design critique. Keeping them here is
 * what lets the critique validate its own output without importing the
 * generator that calls it.
 */

/**
 * Validates model-designed email HTML before it can be persisted: must be a
 * complete document and must not smuggle in script. Returns the trimmed HTML
 * or null (null → the caller falls back to the code template). Kept strict
 * and code-level, never trust the model for safety guarantees.
 *
 * Deliberately does NOT require dark-mode CSS here: this validator is shared
 * with html-edit.ts's commitHtmlEdit (every "Apply text/color/style" patch
 * re-validates the whole patched document), and a content edit isn't
 * responsible for authoring head-level dark-mode CSS. Requiring it here would
 * reject every edit on any draft that doesn't already have it. The dark-mode
 * requirement lives at the fresh-generation callsite instead (see
 * renderEmailForContext), where there's a safe template fallback.
 */
export function validateModelEmailHtml(html: string | undefined): string | null {
  if (!html) return null;
  const h = html.trim();
  if (h.length < 500) return null; // a real designed email is never this small
  if (!/<html[\s>]/i.test(h)) return null;
  if (!/<\/html>\s*$/i.test(h)) return null;
  if (!/<body[\s>]/i.test(h)) return null;
  if (/<script[\s>]/i.test(h) || /javascript:/i.test(h)) return null;
  if (/<link[\s>]/i.test(h) || /<iframe[\s>]/i.test(h)) return null;
  return h;
}

// MailerLite rejects campaigns without the {$unsubscribe} merge tag. The prompt
// asks for it, but we guarantee it here so a forgetful generation can't produce
// an unpublishable draft.
export function ensureUnsubscribeTag(html: string): string {
  if (html.includes("{$unsubscribe}")) return html;

  const footer =
    '<p style="margin:24px 0 0;font-size:12px;color:#888;text-align:center;">' +
    '<a href="{$unsubscribe}" style="color:#888;">Unsubscribe</a></p>';

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return html + footer;
}
