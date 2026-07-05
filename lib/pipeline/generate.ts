import "server-only";
import { DRAFT_MODEL, cacheableSystem, getAnthropic } from "@/lib/clients/anthropic";
import {
  getCampaign,
  getDraftWithJobContext,
  getLatestDraftVersion,
  getTopicContext,
  patchDraftGeneration,
  populateDraft,
  persistRegeneratedDraft,
  rejectDraftRecord,
  updateCampaign,
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
  CampaignBrief,
  EmailCopy,
  EmailDraftContent,
  EmailTemplateId,
  DraftMeta,
  DraftSeoData,
  TopicContext,
} from "@/lib/db/types";
import { stripEmDashes } from "@/lib/text";
import { MAX_DRAFT_VERSIONS } from "./constants";

/** Phase-by-phase events emitted while a draft shell is being filled in. */
export type GenerationEvent =
  | { type: "phase"; phase: string; label: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Fills in an already-created draft shell (see `createDraftShell` in
 * lib/db/queries.ts) with a real generated email, reporting phase progress
 * via `onEvent` as it goes. Used by the generation SSE route so the draft
 * page can show honest wait progress instead of a fake rotator.
 *
 * Throws on a model response that doesn't match the schema; the caller
 * (the SSE route) turns that into a visible error phase (Guardrail #5:
 * never swallow errors), after recording it on the draft's meta.generation.
 */
export async function generateEmailForTopicStreamed(
  draftId: string,
  ctx: TopicContext,
  opts: { campaignId?: string },
  onEvent: (event: GenerationEvent) => void,
): Promise<void> {
  try {
    const writing = { phase: "writing", label: "Writing your email" };
    await patchDraftGeneration(draftId, writing);
    onEvent({ type: "phase", ...writing });

    const brief = await loadCampaignBrief(opts.campaignId);
    const tokens = resolveBrandTokens(ctx.brand);
    const { system, user } = buildEmailMessages(ctx, tokens, { brief });
    const parsed = await generateEmailCopy(system, user);

    const { content, copy, templateId, designSource } = renderEmailForContext(
      ctx,
      parsed,
    );

    const checking = { phase: "checking", label: "Running quality checks" };
    await patchDraftGeneration(draftId, checking);
    onEvent({ type: "phase", ...checking });

    const { meta: qaMeta, seoData } = await runQaPass(ctx, content);
    const meta: DraftMeta = {
      ...qaMeta,
      email_template_id: templateId,
      email_copy: copy,
      email_design_source: designSource,
    };

    await populateDraft(draftId, { content, meta, seoData });

    if (opts.campaignId) {
      await updateCampaign(opts.campaignId, { status: "drafted" });
    }

    onEvent({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    await patchDraftGeneration(draftId, { status: "error", error: message }).catch(
      (e) => console.error("[generate] failed to record error phase:", e),
    );
    onEvent({ type: "error", message });
    throw err;
  }
}

/** Loads a campaign's brief, or null when no campaign is driving this draft. */
async function loadCampaignBrief(
  campaignId: string | undefined | null,
): Promise<CampaignBrief | null> {
  if (!campaignId) return null;
  const campaign = await getCampaign(campaignId);
  return campaign?.brief ?? null;
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
  // The system prompt (brand guidelines/voice/positioning + the email design
  // system) only varies by template, of which there are three, so it's
  // identical across every topic generated with the same layout. Caching it
  // means back-to-back drafts in a session, and same-request retries below,
  // reprice at roughly a 90% discount instead of full price every time.
  const cachedSystem = cacheableSystem(system);

  // Streamed because copy + a complete designed HTML document + adaptive
  // thinking share this token budget, and the SDK requires streaming for
  // requests that could outlive its non-streaming timeout ceiling.
  const call = () =>
    getAnthropic()
      .messages.stream({
        model: DRAFT_MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        system: cachedSystem,
        messages: [{ role: "user", content: user }],
        tools: [EMAIL_TOOL],
        tool_choice: { type: "tool", name: "save_email_draft" },
      })
      .finalMessage();

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
 * Turns Claude's output into the persisted draft content. The model designs
 * the full HTML under the email design system prompt; if that HTML fails
 * validation, the structured copy is rendered through the code template the
 * topic's distribution recipe points at, so a draft always exists. Em-dashes
 * are stripped from both paths, and the {$unsubscribe} tag is guaranteed.
 */
function renderEmailForContext(
  ctx: TopicContext,
  parsed: EmailDraftOutput,
  templateOverride?: EmailTemplateId,
): {
  content: EmailDraftContent;
  copy: EmailCopy;
  templateId: EmailTemplateId;
  designSource: "model" | "template";
} {
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

  const templateId = templateOverride ?? resolveEmailTemplateId(ctx.topic);
  const tokens = resolveBrandTokens(ctx.brand);

  const modelHtml = validateModelEmailHtml(parsed.html);
  let designSource: "model" | "template";
  let html: string;
  if (modelHtml) {
    designSource = "model";
    html = modelHtml;
  } else {
    console.warn(
      "[generate] model HTML failed validation; falling back to code template",
      templateId,
    );
    designSource = "template";
    html = renderEmailTemplate(templateId, { copy, tokens });
  }
  html = ensureUnsubscribeTag(stripEmDashes(html));

  return {
    content: { subject: copy.subject, preheader: copy.preheader, html },
    copy,
    templateId,
    designSource,
  };
}

/**
 * Validates model-designed email HTML before it can be persisted: must be a
 * complete document and must not smuggle in script. Returns the trimmed HTML
 * or null (null → the caller falls back to the code template). Kept strict
 * and code-level, never trust the model for safety guarantees.
 */
export function validateModelEmailHtml(html: string | undefined): string | null {
  if (!html) return null;
  const h = html.trim();
  if (h.length < 500) return null; // a real designed email is never this small
  if (!/<html[\s>]/i.test(h)) return null;
  if (!/<\/html>\s*$/i.test(h)) return null;
  if (!/<body[\s>]/i.test(h)) return null;
  if (/<script[\s>]/i.test(h) || /javascript:/i.test(h)) return null;
  if (/<link[\s>]/i.test(h) || /<iframe[\s>]/i.test(h)) return null;
  return h;
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
  opts: { templateOverride?: EmailTemplateId } = {},
): Promise<{ newDraftId: string } | { capped: true }> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) throw new Error(`Draft ${draftId} not found`);

  const latestVersion = await getLatestDraftVersion(draftCtx.jobId);
  if (latestVersion >= MAX_DRAFT_VERSIONS) return { capped: true };

  // Record the rejection before generating so it's persisted even if Claude errors.
  await rejectDraftRecord(draftId, feedback);

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) throw new Error(`Topic not found for draft ${draftId}`);

  const brief = await loadCampaignBrief(draftCtx.campaignId);
  const tokens = resolveBrandTokens(ctx.brand);
  const { system, user } = buildEmailMessages(ctx, tokens, {
    brief,
    templateOverride: opts.templateOverride,
    rejection: {
      feedback,
      previousSubject: draftCtx.content.subject,
      previousPreheader: draftCtx.content.preheader,
    },
  });

  const parsed = await generateEmailCopy(system, user);

  const { content, copy, templateId, designSource } = renderEmailForContext(
    ctx,
    parsed,
    opts.templateOverride,
  );

  const { meta: qaMeta, seoData } = await runQaPass(ctx, content);
  const meta: DraftMeta = {
    ...qaMeta,
    email_template_id: templateId,
    email_copy: copy,
    email_design_source: designSource,
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
export function ensureUnsubscribeTag(html: string): string {
  if (html.includes("{$unsubscribe}")) return html;

  const footer =
    '<p style="margin:24px 0 0;font-size:12px;color:#888;text-align:center;">' +
    '<a href="{$unsubscribe}" style="color:#888;">Unsubscribe</a></p>';

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return html + footer;
}
