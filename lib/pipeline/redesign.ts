import "server-only";
import { DRAFT_MODEL, FAST_MODEL, getAnthropic } from "@/lib/clients/anthropic";
import {
  getDraftWithJobContext,
  getTopicContext,
  updateDraftContent,
} from "@/lib/db/queries";
import { resolveBrandTokens } from "@/lib/email/templates";
import { resolveEmailTemplateId } from "@/prompts/generate-email";
import {
  REDESIGN_TOOL,
  buildRedesignMessages,
  type RedesignToolInput,
} from "@/prompts/redesign-email";
import { stripEmDashes } from "@/lib/text";
import { ensureUnsubscribeTag, validateModelEmailHtml } from "./generate";
import type { StyleEditHistoryEntry } from "@/lib/db/types";

// Instant full redesign: same copy, fresh HTML, current brand tokens applied
// consistently everywhere (the fix for a design fallen out of sync with
// brand colors in several different scattered places, which no single
// find/replace patch can fix in one shot). No thinking, no copywriting, so
// it's cheap despite regenerating the whole document. Shares the same
// undo stack as adjust-style (drafts.meta.style_edit_history) since it's
// the same kind of operation: a style-only change, not a content version.

export type RedesignResult =
  | { ok: true; html: string; history: StyleEditHistoryEntry[] }
  | { ok: false; error: string };

const MAX_HISTORY = 10;

async function attemptRedesign(
  model: string,
  system: string,
  user: string,
): Promise<{ html: string } | { error: string }> {
  const response = await getAnthropic().messages.create({
    model,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: user }],
    tools: [REDESIGN_TOOL],
    tool_choice: { type: "tool", name: "save_redesigned_email" },
  });
  const tu = response.content.find(
    (b) => b.type === "tool_use" && b.name === "save_redesigned_email",
  );
  if (!tu || tu.type !== "tool_use") return { error: "The model returned nothing." };
  const raw = tu.input as RedesignToolInput;
  const validated = validateModelEmailHtml(raw.html);
  if (!validated) return { error: "That redesign produced invalid HTML." };
  return { html: ensureUnsubscribeTag(stripEmDashes(validated)) };
}

export async function redesignEmail(
  draftId: string,
  direction?: string,
): Promise<RedesignResult> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) return { ok: false, error: "Draft not found." };

  const copy = draftCtx.meta.email_copy;
  if (!copy) {
    return {
      ok: false,
      error: "This draft has no stored copy to redesign from. Use Reject & regenerate instead.",
    };
  }

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) return { ok: false, error: "Topic not found for this draft." };

  const tokens = resolveBrandTokens(ctx.brand);
  const templateId = draftCtx.meta.email_template_id ?? resolveEmailTemplateId(ctx.topic);
  const { system, user } = buildRedesignMessages({ copy, tokens, templateId, ctx, direction });

  // FAST_MODEL first (no copywriting judgment needed, just following the
  // design brief), retry once, then escalate to DRAFT_MODEL, mirroring the
  // adjust-style reliability pattern.
  let attempt = await attemptRedesign(FAST_MODEL, system, user);
  if ("error" in attempt) attempt = await attemptRedesign(FAST_MODEL, system, user);
  if ("error" in attempt) attempt = await attemptRedesign(DRAFT_MODEL, system, user);
  if ("error" in attempt) {
    return { ok: false, error: `${attempt.error} Try again.` };
  }

  const html = attempt.html;
  const history = [
    ...(draftCtx.meta.style_edit_history ?? []),
    {
      html: draftCtx.content.html,
      instruction: direction
        ? `Redesign: ${direction}`
        : "Redesign using current brand colors",
      at: new Date().toISOString(),
    },
  ].slice(-MAX_HISTORY);

  await updateDraftContent(
    draftId,
    { subject: draftCtx.content.subject, preheader: draftCtx.content.preheader, html },
    { ...draftCtx.meta, style_edit_history: history, email_design_source: "model" },
  );

  return { ok: true, html, history };
}
