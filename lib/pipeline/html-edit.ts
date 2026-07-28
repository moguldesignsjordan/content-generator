import "server-only";
import { updateDraftContent } from "@/lib/db/queries";
import { stripEmDashes } from "@/lib/text";
import { ensureDarkModeReadability } from "@/lib/email/dark-mode";
import { ensureBrandLogo } from "@/lib/email/footer-logo";
import { ensureEditableRegions } from "@/lib/email/inline-style";
import { ensureUnsubscribeTag, validateModelEmailHtml } from "@/lib/email/validate";
// applyEdits moved to a leaf module (lib/email/patch.ts) so callers that only
// need patching don't pull in this module's DB and pipeline dependencies.
export { applyEdits, type HtmlPatch } from "@/lib/email/patch";
import type {
  DraftJobContext,
  DraftMeta,
  EditType,
  StyleEditHistoryEntry,
} from "@/lib/db/types";
import type { BrandTokens } from "@/lib/email/templates/types";

// Shared tail of every in-place email edit (style, copy, recolor): take a
// model-produced HTML patch, validate + sanitize it, push the pre-edit HTML
// onto the shared undo stack, and persist. The point of centralizing this is
// that one Undo button then covers all three edit types, and every patch goes
// through the same safety gates (validateModelEmailHtml / stripEmDashes /
// ensureUnsubscribeTag) without each pipeline re-implementing them.
//
// find/replace application lives in lib/email/patch.ts (re-exported above), so
// the "find must match exactly once" safety property is identical across
// pipelines without every caller inheriting this module's dependencies.

const MAX_HISTORY = 10;

export type HtmlEditResult =
  | { ok: true; html: string; history: StyleEditHistoryEntry[] }
  | { ok: false; error: string };

/**
 * Finalizes a model-produced HTML patch: validate, sanitize (strip em-dashes,
 * guarantee the unsubscribe tag), push the pre-edit HTML onto the shared undo
 * stack, and persist in place (no new draft version). `extraMeta` is merged
 * into the persisted meta so a pipeline can also update a synced `email_copy`
 * in the same write. Returns the new history for the client, or an error if
 * the patch didn't validate.
 */
export async function commitHtmlEdit(args: {
  draftCtx: DraftJobContext;
  /** Model-produced HTML to validate and save. */
  html: string;
  /** Human-readable label for the history/undo entry (the instruction or a summary). */
  label: string;
  /** What kind of edit this is, for history display. */
  type?: EditType;
  /** Meta to merge in (e.g. color_overrides, email_copy) alongside the history push. */
  extraMeta?: Partial<DraftMeta>;
  /** When known, guarantees the real logo (not a text-wordmark stand-in) in
   * the header/footer after a model-authored patch. Omitted by callers that
   * don't already have brand tokens in scope (mechanical, non-AI edits that
   * can't reintroduce this). */
  tokens?: BrandTokens;
}): Promise<HtmlEditResult> {
  const { draftCtx, html, label, type, extraMeta, tokens } = args;

  const validated = validateModelEmailHtml(html);
  if (!validated) return { ok: false, error: "That edit produced invalid HTML." };
  // Dark-mode repair runs on every edit, so a patch that introduces dark text
  // (a model recolor, a user picking black in the Design panel) can't leave the
  // email unreadable in dark mode — and older drafts get repaired on their
  // next edit. Region tagging repairs older drafts the same way, so copy the
  // model left outside a data-region becomes editable after any edit. Logo
  // repair is the same story: a model rewrite can drop the real logo for a
  // text wordmark, so any edit that has brand tokens available heals it too.
  // ensureUnsubscribeTag stays last: it is the publish guarantee.
  let safeHtml = ensureUnsubscribeTag(
    ensureEditableRegions(ensureDarkModeReadability(stripEmDashes(validated))),
  );
  if (tokens) safeHtml = ensureBrandLogo(safeHtml, tokens);

  const history: StyleEditHistoryEntry[] = [
    ...(draftCtx.meta.style_edit_history ?? []),
    {
      html: draftCtx.content.html,
      instruction: label,
      at: new Date().toISOString(),
      ...(type ? { type } : {}),
    },
  ].slice(-MAX_HISTORY);

  await updateDraftContent(
    draftCtx.draftId,
    {
      subject: draftCtx.content.subject,
      preheader: draftCtx.content.preheader,
      html: safeHtml,
    },
    { ...draftCtx.meta, ...extraMeta, style_edit_history: history },
  );

  return { ok: true, html: safeHtml, history };
}
