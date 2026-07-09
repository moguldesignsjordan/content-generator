import "server-only";
import {
  DRAFT_MODEL,
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
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
import { spliceHeroImage } from "./generate-image";
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

// `system` here is the email design brief keyed only by template + brand
// tokens (three variants total), identical across every redesign call for
// this brand; caching it makes the same-model retry below and every later
// redesign within the cache window cost a fraction of full input price.
async function attemptRedesign(
  draftId: string,
  model: string,
  system: string,
  user: string,
): Promise<{ html: string } | { error: string }> {
  const response = await getAnthropic().messages.create({
    model,
    max_tokens: 8192,
    system: cacheableSystem(system),
    messages: [{ role: "user", content: user }],
    tools: [REDESIGN_TOOL],
    tool_choice: { type: "tool", name: "save_redesigned_email" },
  });
  logUsage("redesign", model, response.usage, { draftId });
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
  const heroImage = draftCtx.meta.hero_image;
  const { system, user } = buildRedesignMessages({
    copy,
    tokens,
    templateId,
    ctx,
    direction,
    heroImage,
    styleId: draftCtx.meta.email_style_variant,
  });

  // FAST_MODEL first (no copywriting judgment needed, just following the
  // design brief), retry once, then escalate to DRAFT_MODEL, mirroring the
  // adjust-style reliability pattern.
  let attempt = await attemptRedesign(draftId, FAST_MODEL, system, user);
  if ("error" in attempt) attempt = await attemptRedesign(draftId, FAST_MODEL, system, user);
  if ("error" in attempt) attempt = await attemptRedesign(draftId, DRAFT_MODEL, system, user);
  if ("error" in attempt) {
    return { ok: false, error: `${attempt.error} Try again.` };
  }

  let html = attempt.html;
  // The prompt asks the model to keep the hero image, but code guarantees it.
  if (heroImage && !html.includes('data-region="image"')) {
    html = spliceHeroImage(html, heroImage) ?? html;
  }
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
