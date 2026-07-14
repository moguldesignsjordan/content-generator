import "server-only";
import {
  DRAFT_MODEL,
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
import { getDraftWithJobContext, getTopicContext } from "@/lib/db/queries";
import { resolveBrandTokens } from "@/lib/email/templates";
import {
  ADJUST_COPY_TOOL,
  buildAdjustCopyMessages,
  type AdjustCopyRegionContext,
  type AdjustCopyToolInput,
  type CopyMode,
} from "@/prompts/adjust-copy";
import { applyEdits, commitHtmlEdit } from "./html-edit";
import type {
  DraftMeta,
  EmailCopy,
  EmailCopySection,
  StyleEditHistoryEntry,
} from "@/lib/db/types";

// Single-shot WORDING edit for one region of an existing email draft. Sibling
// to adjust-style (which edits looks); this edits words, in two modes:
//   - "edit": the user typed exact replacement text -> use verbatim.
//   - "regenerate": rewrite the region's text in the same voice.
// Same machinery as adjust-style: FAST_MODEL -> retry -> DRAFT_MODEL, forced
// save_copy_patch tool returning find/replace pairs scoped to the region's
// snippet, then the shared commitHtmlEdit tail (validate / sanitize / undo
// stack / persist).
//
// After a successful EDIT, we also best-effort sync the structured copy in
// meta.email_copy so a later redesign or regenerate (which rebuilds from
// email_copy) doesn't revert the wording. We match the region's previous
// visible text against email_copy.headline / cta_text / body_sections[].body
// and update whichever field it corresponds to. If nothing matches (e.g. the
// region spans several paragraphs), we skip the sync: the HTML is still
// correct, only a future redesign would use stale copy. REGENERATE mode
// doesn't sync because the new text isn't known here without re-parsing the
// committed HTML.

export type AdjustCopyResult =
  | {
      ok: true;
      html: string;
      history: StyleEditHistoryEntry[];
      caveat?: string;
    }
  | { ok: false; error: string };

async function attemptCopyEdit(
  draftId: string,
  brandId: string,
  model: string,
  system: string,
  user: string,
  currentHtml: string,
): Promise<{ html: string; caveat?: string } | { error: string }> {
  const response = await getAnthropic().messages.create({
    model,
    max_tokens: 2048,
    system: cacheableSystem(system),
    messages: [{ role: "user", content: user }],
    tools: [ADJUST_COPY_TOOL],
    tool_choice: { type: "tool", name: "save_copy_patch" },
  });
  logUsage("adjust-copy", model, response.usage, {
    draftId,
    brandId,
    metered: true,
    requestId: response.id,
  });

  const tu = response.content.find(
    (b) => b.type === "tool_use" && b.name === "save_copy_patch",
  );
  if (!tu || tu.type !== "tool_use") {
    return { error: "The model returned nothing." };
  }
  const raw = tu.input as AdjustCopyToolInput;
  if (!raw.edits?.length) {
    return { error: "The model didn't describe any change." };
  }

  const result = applyEdits(currentHtml, raw.edits);
  if ("error" in result) return { error: result.error };
  return { html: result.html, caveat: raw.client_support_caveat };
}

export async function adjustCopy(
  draftId: string,
  args: {
    regionCtx: AdjustCopyRegionContext;
    mode: CopyMode;
    /** Required for "edit" mode: the exact replacement text. */
    newText?: string;
    /** Optional for "regenerate" mode: guidance shaping the rewrite. */
    instruction?: string;
  },
): Promise<AdjustCopyResult> {
  const { regionCtx, mode, newText, instruction } = args;

  if (mode === "edit" && !newText?.trim()) {
    return { ok: false, error: "Nothing to change." };
  }

  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) return { ok: false, error: "Draft not found." };

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) return { ok: false, error: "Topic not found for this draft." };

  const tokens = resolveBrandTokens(ctx.brand);
  const { system, user } = buildAdjustCopyMessages({
    currentHtml: draftCtx.content.html,
    mode,
    newText,
    instruction,
    tokens,
    regionCtx,
  });

  // Same retry ladder as adjust-style: Haiku is enough for a scoped text swap,
  // but an exact-match find can miss on sampling variance, so retry once on
  // Haiku before escalating to Sonnet.
  const brandId = ctx.brand.id;
  const html = draftCtx.content.html;
  let attempt = await attemptCopyEdit(draftId, brandId, FAST_MODEL, system, user, html);
  if ("error" in attempt) {
    attempt = await attemptCopyEdit(draftId, brandId, FAST_MODEL, system, user, html);
  }
  if ("error" in attempt) {
    attempt = await attemptCopyEdit(draftId, brandId, DRAFT_MODEL, system, user, html);
  }
  if ("error" in attempt) {
    return { ok: false, error: `${attempt.error} Try again.` };
  }

  const label =
    mode === "edit"
      ? `Edited ${regionCtx.label.toLowerCase()} wording`
      : `Regenerated ${regionCtx.label.toLowerCase()} wording`;

  const extraMeta: Partial<DraftMeta> = {};
  if (mode === "edit" && newText && draftCtx.meta.email_copy) {
    const prevText = stripTags(regionCtx.snippet);
    const synced = syncEmailCopy(draftCtx.meta.email_copy, prevText, newText);
    if (synced !== draftCtx.meta.email_copy) {
      extraMeta.email_copy = synced;
    }
  }

  const result = await commitHtmlEdit({
    draftCtx,
    html: attempt.html,
    label,
    type: "copy",
    extraMeta,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    html: result.html,
    history: result.history,
    caveat: attempt.caveat,
  };
}

/** Collapses an HTML snippet to its visible text, whitespace-normalized. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort: if the region's previous visible text matches a single field
 * of email_copy, update that field to the new text. Returns the original
 * object reference when nothing matched (so the caller can skip writing it).
 *
 * Exported because the inline (contentEditable) commit path in
 * /api/drafts/[id]/region-html needs the identical sync: without it, a typed
 * edit lands in the HTML but not in email_copy, and the next redesign — which
 * rebuilds from email_copy — silently reverts the user's own words.
 */
export function syncEmailCopy(
  copy: EmailCopy,
  prevText: string,
  newText: string,
): EmailCopy {
  const prev = stripTags(prevText);
  const next = newText.trim().replace(/\s+/g, " ");
  if (!prev || !next || prev === next) return copy;

  if (copy.headline && norm(copy.headline) === prev) {
    return { ...copy, headline: next };
  }
  if (copy.cta_text && norm(copy.cta_text) === prev) {
    return { ...copy, cta_text: next };
  }

  let changed = false;
  const body_sections: EmailCopySection[] = copy.body_sections.map((s) => {
    if (s.body && norm(s.body) === prev) {
      changed = true;
      return { ...s, body: next };
    }
    if (s.heading && norm(s.heading) === prev) {
      changed = true;
      return { ...s, heading: next };
    }
    return s;
  });

  return changed ? { ...copy, body_sections } : copy;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
