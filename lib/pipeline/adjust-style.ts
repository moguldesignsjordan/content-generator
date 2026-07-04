import "server-only";
import { DRAFT_MODEL, getAnthropic } from "@/lib/clients/anthropic";
import {
  getDraftWithJobContext,
  getTopicContext,
  updateDraftContent,
} from "@/lib/db/queries";
import { resolveBrandTokens } from "@/lib/email/templates";
import {
  ADJUST_STYLE_TOOL,
  buildAdjustStyleMessages,
  type AdjustStyleToolInput,
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

export async function adjustEmailStyle(
  draftId: string,
  instruction: string,
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
  });

  // No thinking, no copy fields, smaller output than a full generation:
  // meaningfully cheaper and faster than reject-and-regenerate.
  const response = await getAnthropic().messages.create({
    model: DRAFT_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    tools: [ADJUST_STYLE_TOOL],
    tool_choice: { type: "tool", name: "save_adjusted_email" },
  });

  const tu = response.content.find(
    (b) => b.type === "tool_use" && b.name === "save_adjusted_email",
  );
  if (!tu || tu.type !== "tool_use") {
    return { ok: false, error: "The model returned nothing. Try again." };
  }
  const raw = tu.input as AdjustStyleToolInput;

  const validated = validateModelEmailHtml(raw.html);
  if (!validated) {
    return {
      ok: false,
      error: "That edit produced invalid HTML. Try rephrasing the request.",
    };
  }
  const html = ensureUnsubscribeTag(stripEmDashes(validated));

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

  return { ok: true, html, history, caveat: raw.client_support_caveat };
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
