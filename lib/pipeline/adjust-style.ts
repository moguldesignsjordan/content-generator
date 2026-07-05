import "server-only";
import {
  DRAFT_MODEL,
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
} from "@/lib/clients/anthropic";
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
} from "@/prompts/adjust-email-style";
import { applyEdits, commitHtmlEdit } from "./html-edit";
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
// verbatim exactly once (or replace_all is set) — enforced by applyEdits in
// html-edit.ts — which is also a real safety property: the model is
// mechanically unable to touch anything outside the span it names.
//
// The validate + sanitize + undo-stack push + persist tail is shared with the
// copy and recolor pipelines via commitHtmlEdit in html-edit.ts, so one Undo
// button covers all three edit types. Every edit pushes the PRE-edit html
// onto drafts.meta.style_edit_history (jsonb, no migration needed), which is
// what makes undo survive a page reload.

export type AdjustStyleResult =
  | {
      ok: true;
      html: string;
      history: StyleEditHistoryEntry[];
      caveat?: string;
    }
  | { ok: false; error: string };

/**
 * One model call + patch-apply attempt. Returns the failure reason (not yet
 * surfaced to the user) so the caller can retry/escalate before giving up.
 * `system` only depends on brand tokens, so it's identical across every
 * style edit for this brand; caching it lets each call after the first (the
 * same-model retry below, and every later edit within the cache window)
 * skip most of its input cost.
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
    system: cacheableSystem(system),
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

  const result = applyEdits(currentHtml, raw.edits);
  if ("error" in result) return { error: result.error };
  return { html: result.html, caveat: raw.client_support_caveat };
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

  const result = await commitHtmlEdit({
    draftCtx,
    html: attempt.html,
    label: instruction,
    type: "style",
  });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    html: result.html,
    history: result.history,
    caveat: attempt.caveat,
  };
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
 * Restores the snapshot verbatim (it was already validated when first
 * committed), so this does not re-run the validation gate.
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
