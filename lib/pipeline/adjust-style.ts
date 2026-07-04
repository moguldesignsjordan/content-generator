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

// One cheap, non-thinking call that edits an existing draft's HTML by
// instruction ("make the header a gradient", "darken the background").
// Deliberately not an agent: single shot, no planning/critique loop. Updates
// the draft IN PLACE (no new version, doesn't touch MAX_DRAFT_VERSIONS)
// since it's a style tweak, not a content regeneration.

export type AdjustStyleResult =
  | { ok: true; html: string }
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

  await updateDraftContent(draftId, {
    subject: draftCtx.content.subject,
    preheader: draftCtx.content.preheader,
    html,
  });

  return { ok: true, html };
}
