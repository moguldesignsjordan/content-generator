import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DRAFT_MODEL, getAnthropic } from "@/lib/clients/anthropic";
import {
  getDraftWithJobContext,
  getLatestDraftVersion,
  getTopicContext,
  persistEmailDraft,
  persistRegeneratedDraft,
  rejectDraftRecord,
} from "@/lib/db/queries";
import {
  EmailDraftSchema,
  buildEmailMessages,
} from "@/prompts/generate-email";
import type { EmailDraftContent } from "@/lib/db/types";
import { MAX_DRAFT_VERSIONS } from "./constants";

/**
 * Generates an on-brand email draft for a topic and saves it as draft v1.
 * Returns the new draft id (the review screen route).
 *
 * Throws on missing topic, unconfigured key, or a model response that doesn't
 * match the schema — the API route turns these into a visible failure state
 * (Guardrail #5: never swallow errors).
 */
export async function generateEmailForTopic(topicId: string): Promise<string> {
  const ctx = await getTopicContext(topicId);
  if (!ctx) throw new Error(`Topic ${topicId} not found`);

  const { system, user } = buildEmailMessages(ctx);

  const response = await getAnthropic().messages.parse({
    model: DRAFT_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(EmailDraftSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("The model did not return a valid email draft.");
  }

  const content: EmailDraftContent = {
    subject: stripEmDashes(parsed.subject.trim()),
    preheader: stripEmDashes(parsed.preheader.trim()),
    html: ensureUnsubscribeTag(stripEmDashes(parsed.html_body)),
  };

  return persistEmailDraft({ ctx, content });
}

export { MAX_DRAFT_VERSIONS } from "./constants";

/**
 * Rejects the current draft and regenerates a new version with the reviewer's
 * feedback woven into the prompt. Returns { newDraftId } on success or
 * { capped: true } when the job has already reached MAX_DRAFT_VERSIONS.
 */
export async function regenerateEmailDraft(
  draftId: string,
  feedback: string,
): Promise<{ newDraftId: string } | { capped: true }> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) throw new Error(`Draft ${draftId} not found`);

  const latestVersion = await getLatestDraftVersion(draftCtx.jobId);
  if (latestVersion >= MAX_DRAFT_VERSIONS) return { capped: true };

  // Record the rejection before generating so it's persisted even if Claude errors.
  await rejectDraftRecord(draftId, feedback);

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) throw new Error(`Topic not found for draft ${draftId}`);

  const { system, user } = buildEmailMessages(ctx, {
    feedback,
    previousDraft: draftCtx.content,
  });

  const response = await getAnthropic().messages.parse({
    model: DRAFT_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(EmailDraftSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("The model did not return a valid email draft.");

  const content: EmailDraftContent = {
    subject: stripEmDashes(parsed.subject.trim()),
    preheader: stripEmDashes(parsed.preheader.trim()),
    html: ensureUnsubscribeTag(stripEmDashes(parsed.html_body)),
  };

  const newDraftId = await persistRegeneratedDraft({
    jobId: draftCtx.jobId,
    version: latestVersion + 1,
    content,
  });

  return { newDraftId };
}

// Em-dashes are banned from all email output (brand voice rule). Replace
// the unicode char, HTML entities, and double-hyphen stand-ins with ", "
// so the sentence still reads naturally.
function stripEmDashes(text: string): string {
  return text
    .replace(/—/g, ", ")   // — (unicode em-dash)
    .replace(/&mdash;/gi, ", ") // HTML named entity
    .replace(/&#8212;/g, ", ")  // HTML numeric entity
    .replace(/--/g, ", ");      // double-hyphen used as em-dash
}

// MailerLite rejects campaigns without the {$unsubscribe} merge tag. The prompt
// asks for it, but we guarantee it here so a forgetful generation can't produce
// an unpublishable draft.
function ensureUnsubscribeTag(html: string): string {
  if (html.includes("{$unsubscribe}")) return html;

  const footer =
    '<p style="margin:24px 0 0;font-size:12px;color:#888;text-align:center;">' +
    '<a href="{$unsubscribe}" style="color:#888;">Unsubscribe</a></p>';

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return html + footer;
}
