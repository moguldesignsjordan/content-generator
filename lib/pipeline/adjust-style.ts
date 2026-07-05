import "server-only";
import { DRAFT_MODEL, FAST_MODEL, getAnthropic } from "@/lib/clients/anthropic";
import {
  getDraftWithJobContext,
  getTopicContext,
  updateDraftContent,
} from "@/lib/db/queries";
import { resolveBrandTokens } from "@/lib/email/templates";
import {
  ADJUST_STYLE_TOOL,
  buildAdjustStyleMessages,
  type AdjustStyleRegionContext,
  type AdjustStyleToolInput,
  type StyleEdit,
} from "@/prompts/adjust-email-style";
import { stripEmDashes } from "@/lib/text";
import { ensureUnsubscribeTag, validateModelEmailHtml } from "./generate";
import type { StyleEditHistoryEntry } from "@/lib/db/types";

// One cheap, non-thinking call that edits an existing draft's HTML by
// instruction ("make the header a gradient", "darken the background").
// Deliberately not an agent: single shot, no planning/critique loop. Updates
// the draft IN PLACE (no new version, doesn't touch MAX_DRAFT_VERSIONS)
// since it's a style tweak, not a content regeneration.
//
// Patch-based (find/replace), not full-document echo: the model only OUTPUTS
// the small snippet(s) that change, which is what actually drives cost and
// latency (output tokens, not input). Each find must match the current HTML
// verbatim exactly once (or replace_all is set), which is also a real safety
// property: the model is mechanically unable to touch anything outside the
// span it names, unlike a full rewrite where "preserve everything else" was
// only ever a request.
//
// Every edit pushes the PRE-edit html onto a small undo stack stored in
// drafts.meta.style_edit_history (jsonb, no migration needed). This is what
// makes undo survive a page reload, unlike the old client-memory-only undo:
// an edit you don't want is never unrecoverable again.

const MAX_HISTORY = 10;

export type AdjustStyleResult =
  | {
      ok: true;
      html: string;
      history: StyleEditHistoryEntry[];
      caveat?: string;
    }
  | { ok: false; error: string };

/**
 * Applies one find/replace edit to html. Fails closed: find must appear at
 * least once, and if it appears more than once without replace_all, that's
 * ambiguous (which occurrence was meant?) so it's rejected rather than
 * guessed, instead of silently touching only the first match.
 */
function applyEdit(html: string, edit: StyleEdit): { html: string } | { error: string } {
  if (!edit.find) return { error: "An edit was missing its find text." };
  const occurrences = html.split(edit.find).length - 1;
  if (occurrences === 0) {
    return {
      error: `Couldn't locate the exact text to change (starting "${edit.find.slice(0, 60)}"). Try rephrasing.`,
    };
  }
  if (occurrences > 1 && !edit.replace_all) {
    return {
      error: `That change matches ${occurrences} places ambiguously. Be more specific.`,
    };
  }
  const next = edit.replace_all
    ? html.split(edit.find).join(edit.replace)
    : html.replace(edit.find, edit.replace);
  return { html: next };
}

/**
 * One model call + patch-apply attempt. Returns the failure reason (not yet
 * surfaced to the user) so the caller can retry/escalate before giving up.
 */
async function attemptEdit(
  model: string,
  system: string,
  user: string,
  currentHtml: string,
): Promise<{ html: string; caveat?: string } | { error: string }> {
  const response = await getAnthropic().messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: user }],
    tools: [ADJUST_STYLE_TOOL],
    tool_choice: { type: "tool", name: "save_style_patch" },
  });

  const tu = response.content.find(
    (b) => b.type === "tool_use" && b.name === "save_style_patch",
  );
  if (!tu || tu.type !== "tool_use") {
    return { error: "The model returned nothing." };
  }
  const raw = tu.input as AdjustStyleToolInput;
  if (!raw.edits?.length) {
    return { error: "The model didn't describe any change." };
  }

  let patched = currentHtml;
  for (const edit of raw.edits) {
    const result = applyEdit(patched, edit);
    if ("error" in result) return { error: result.error };
    patched = result.html;
  }

  const validated = validateModelEmailHtml(patched);
  if (!validated) return { error: "That edit produced invalid HTML." };

  return {
    html: ensureUnsubscribeTag(stripEmDashes(validated)),
    caveat: raw.client_support_caveat,
  };
}

export async function adjustEmailStyle(
  draftId: string,
  instruction: string,
  regionCtx?: AdjustStyleRegionContext,
): Promise<AdjustStyleResult> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) return { ok: false, error: "Draft not found." };

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) return { ok: false, error: "Topic not found for this draft." };

  const tokens = resolveBrandTokens(ctx.brand);
  const { system, user } = buildAdjustStyleMessages({
    currentHtml: draftCtx.content.html,
    instruction,
    tokens,
    regionCtx,
  });

  // FAST_MODEL (Haiku) first: "find the exact snippet and describe a
  // targeted change" is a much narrower task than drafting or reproducing a
  // whole document, and Haiku handled the disambiguation cases that broke
  // this feature (header bar vs. header text, gradient text via
  // background-clip) correctly in live testing. But an exact-match find can
  // occasionally miss on sampling variance alone (verified live: a retry
  // with fresh output matched fine), so retry once on the SAME cheap model
  // before escalating to DRAFT_MODEL (Sonnet) as a last resort. The user
  // only ever sees an error if all three attempts fail.
  let attempt = await attemptEdit(FAST_MODEL, system, user, draftCtx.content.html);
  if ("error" in attempt) {
    attempt = await attemptEdit(FAST_MODEL, system, user, draftCtx.content.html);
  }
  if ("error" in attempt) {
    attempt = await attemptEdit(DRAFT_MODEL, system, user, draftCtx.content.html);
  }
  if ("error" in attempt) {
    return { ok: false, error: `${attempt.error} Try rephrasing the request.` };
  }

  const { html, caveat } = attempt;

  const history = [
    ...(draftCtx.meta.style_edit_history ?? []),
    {
      html: draftCtx.content.html,
      instruction,
      at: new Date().toISOString(),
    },
  ].slice(-MAX_HISTORY);

  await updateDraftContent(
    draftId,
    { subject: draftCtx.content.subject, preheader: draftCtx.content.preheader, html },
    { ...draftCtx.meta, style_edit_history: history },
  );

  return { ok: true, html, history, caveat };
}

/** Current undo stack for a draft, oldest first, without touching content. */
export async function getStyleEditHistory(
  draftId: string,
): Promise<{ html: string; history: StyleEditHistoryEntry[] } | null> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) return null;
  return {
    html: draftCtx.content.html,
    history: draftCtx.meta.style_edit_history ?? [],
  };
}

/**
 * Pops the most recent entry off the undo stack and restores it as the
 * draft's current html. Server-authoritative (unlike the old client-only
 * undo), so it survives reloads and works no matter when you come back.
 */
export async function undoLastStyleEdit(
  draftId: string,
): Promise<AdjustStyleResult> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) return { ok: false, error: "Draft not found." };

  const history = draftCtx.meta.style_edit_history ?? [];
  const last = history[history.length - 1];
  if (!last) return { ok: false, error: "Nothing to undo." };

  const remaining = history.slice(0, -1);
  await updateDraftContent(
    draftId,
    {
      subject: draftCtx.content.subject,
      preheader: draftCtx.content.preheader,
      html: last.html,
    },
    { ...draftCtx.meta, style_edit_history: remaining },
  );

  return { ok: true, html: last.html, history: remaining };
}
