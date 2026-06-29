import "server-only";
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
  EMAIL_TOOL,
  EmailDraftSchema,
  buildEmailMessages,
  resolveEmailTemplateId,
  type EmailDraftOutput,
} from "@/prompts/generate-email";
import { QA_TOOL, QaSchema, buildQaMessages } from "@/prompts/qa-email";
import {
  renderEmailTemplate,
  resolveBrandTokens,
} from "@/lib/email/templates";
import type {
  EmailCopy,
  EmailDraftContent,
  EmailTemplateId,
  DraftMeta,
  DraftSeoData,
  TopicContext,
} from "@/lib/db/types";
import { stripEmDashes } from "@/lib/text";
import { MAX_DRAFT_VERSIONS } from "./constants";

/**
 * Generates an on-brand email draft for a topic and saves it as draft v1.
 * Returns the new draft id (the review screen route).
 *
 * Throws on missing topic, unconfigured key, or a model response that doesn't
 * match the schema, the API route turns these into a visible failure state
 * (Guardrail #5: never swallow errors).
 */
export async function generateEmailForTopic(topicId: string): Promise<string> {
  const ctx = await getTopicContext(topicId);
  if (!ctx) throw new Error(`Topic ${topicId} not found`);

  const { system, user } = buildEmailMessages(ctx);

  const parsed = await generateEmailCopy(system, user);

  const { content, copy, templateId } = renderEmailForContext(ctx, parsed);

  const { meta: qaMeta, seoData } = await runQaPass(ctx, content);
  const meta: DraftMeta = {
    ...qaMeta,
    email_template_id: templateId,
    email_copy: copy,
  };
  return persistEmailDraft({ ctx, content, meta, seoData });
}

/**
 * Calls Claude for structured email copy via FORCED TOOL USE, with one retry
 * on failure. We force `save_email_draft` (tool_choice) instead of json_schema
 * output_config: tool inputs are reliably structured and can't come back as
 * markdown-fenced JSON, which the json_schema path was producing under thinking.
 * Logs the raw response content on failure so failures are diagnosable.
 */
async function generateEmailCopy(
  system: string,
  user: string,
): Promise<EmailDraftOutput> {
  const call = () =>
    getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: user }],
      tools: [EMAIL_TOOL],
      tool_choice: { type: "tool", name: "save_email_draft" },
    });

  const extract = (resp: Awaited<ReturnType<typeof call>>): EmailDraftOutput => {
    const tu = resp.content.find(
      (b) => b.type === "tool_use" && b.name === "save_email_draft",
    );
    if (!tu || tu.type !== "tool_use") {
      const preview = JSON.stringify(resp.content).slice(0, 800);
      throw new Error(
        `Model did not call save_email_draft. Stop reason: ${resp.stop_reason}. Raw content: ${preview}`,
      );
    }
    const parsed = EmailDraftSchema.safeParse(tu.input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid email copy from tool: ${issues}`);
    }
    return parsed.data;
  };

  try {
    return extract(await call());
  } catch (err) {
    console.error("[generate] email copy failed, retrying once:", err);
    return extract(await call());
  }
}

/**
 * Renders Claude's structured copy into a designed, on-brand HTML email using
 * the template the topic's distribution recipe points at. Em-dashes are
 * stripped from the COPY only (the template HTML is controlled and dash-free).
 * Returns the persisted content shape plus the copy/template so they can be
 * stashed on the draft's meta.
 */
function renderEmailForContext(
  ctx: TopicContext,
  parsed: EmailDraftOutput,
): { content: EmailDraftContent; copy: EmailCopy; templateId: EmailTemplateId } {
  const copy: EmailCopy = {
    subject: stripEmDashes(parsed.subject.trim()),
    preheader: stripEmDashes(parsed.preheader.trim()),
    headline: stripEmDashes(parsed.headline.trim()),
    body_sections: parsed.body_sections.map((s) => ({
      heading: s.heading ? stripEmDashes(s.heading.trim()) : undefined,
      body: stripEmDashes(s.body.trim()),
    })),
    cta_text: stripEmDashes(parsed.cta_text.trim()),
    cta_url: parsed.cta_url?.trim() || undefined,
  };

  const templateId = resolveEmailTemplateId(ctx.topic);
  const tokens = resolveBrandTokens(ctx.brand);
  const html = ensureUnsubscribeTag(renderEmailTemplate(templateId, { copy, tokens }));

  return {
    content: { subject: copy.subject, preheader: copy.preheader, html },
    copy,
    templateId,
  };
}

export { MAX_DRAFT_VERSIONS } from "./constants";

/**
 * Runs a QA pass on a generated email draft. Non-fatal, returns empty
 * objects if the call fails so a QA error never blocks the draft from saving.
 */
async function runQaPass(
  ctx: TopicContext,
  content: EmailDraftContent,
): Promise<{ meta: DraftMeta; seoData: DraftSeoData }> {
  try {
    const { system, user } = buildQaMessages(ctx, content);
    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
      tools: [QA_TOOL],
      tool_choice: { type: "tool", name: "qa_review" },
    });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "qa_review",
    );
    if (!tu || tu.type !== "tool_use") return { meta: {}, seoData: {} };
    const parsed = QaSchema.safeParse(tu.input);
    if (!parsed.success) {
      console.error("[generate] QA tool input invalid:", parsed.error.issues);
      return { meta: {}, seoData: {} };
    }
    const qa = parsed.data;

    return {
      meta: {
        meta_title: qa.meta_title,
        meta_description: qa.meta_description,
      },
      seoData: {
        keyword_used: qa.keyword_used,
        keyword_placement: qa.keyword_placement,
        banned_terms_found: qa.banned_terms_found,
        readability_note: qa.readability_note,
        qa_pass: qa.qa_pass,
        issues: qa.issues,
      },
    };
  } catch (err) {
    console.error("QA pass failed (non-fatal):", err);
    return { meta: {}, seoData: {} };
  }
}

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
    previousSubject: draftCtx.content.subject,
    previousPreheader: draftCtx.content.preheader,
  });

  const parsed = await generateEmailCopy(system, user);

  const { content, copy, templateId } = renderEmailForContext(ctx, parsed);

  const { meta: qaMeta, seoData } = await runQaPass(ctx, content);
  const meta: DraftMeta = {
    ...qaMeta,
    email_template_id: templateId,
    email_copy: copy,
  };

  const newDraftId = await persistRegeneratedDraft({
    jobId: draftCtx.jobId,
    version: latestVersion + 1,
    content,
    meta,
    seoData,
  });

  return { newDraftId };
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
