import "server-only";
import {
  DRAFT_MODEL,
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
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
  ContentImage,
  EmailCopy,
  EmailDraftContent,
  EmailTemplateId,
  DraftMeta,
  DraftSeoData,
  DraftUsage,
  TopicContext,
} from "@/lib/db/types";
import { stripEmDashes } from "@/lib/text";
import { contrastIssues, findBannedTerms } from "@/lib/email/quality";
import { spliceHeroImage } from "./generate-image";
import { accumulateUsage, type UsageDelta } from "./cost";
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
    const { parsed, usageDeltas } = await generateEmailCopy(system, user);

    const { content, copy, templateId, designSource } = renderEmailForContext(
      ctx,
      parsed,
    );

    const checking = { phase: "checking", label: "Running quality checks" };
    await patchDraftGeneration(draftId, checking);
    onEvent({ type: "phase", ...checking });

    const qa = await runQaPass(ctx, copy, content.html);
    usageDeltas.push(...qa.usageDeltas);
    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const meta: DraftMeta = {
      ...qa.meta,
      email_template_id: templateId,
      email_copy: copy,
      email_design_source: designSource,
      usage,
    };
    const seoData = qa.seoData;

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
): Promise<{ parsed: EmailDraftOutput; usageDeltas: UsageDelta[] }> {
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

  const usageDeltas: UsageDelta[] = [];
  try {
    const resp = await call();
    logUsage("email-copy", resp.usage);
    usageDeltas.push({ model: DRAFT_MODEL, ...resp.usage });
    return { parsed: extract(resp), usageDeltas };
  } catch (err) {
    console.error("[generate] email copy failed, retrying once:", err);
    const resp = await call();
    logUsage("email-copy-retry", resp.usage);
    usageDeltas.push({ model: DRAFT_MODEL, ...resp.usage });
    return { parsed: extract(resp), usageDeltas };
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
  heroImage?: ContentImage,
): {
  content: EmailDraftContent;
  copy: EmailCopy;
  templateId: EmailTemplateId;
  designSource: "model" | "template";
} {
  const copy: EmailCopy = {
    subject: stripEmDashes(parsed.subject.trim()),
    subject_variants: (parsed.subject_variants ?? [])
      .map((v) => stripEmDashes(v.trim()))
      .filter((v) => v.length > 0)
      .slice(0, 3),
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

  // A regeneration keeps the prior hero image: the prompt asks the model to
  // place it, but the code path guarantees it regardless of compliance (and
  // covers the template fallback, which knows nothing about images).
  if (heroImage && !html.includes('data-region="image"')) {
    html = spliceHeroImage(html, heroImage) ?? html;
  }

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
 * Runs a QA pass on a generated email draft. The model half audits the
 * STRUCTURED copy on FAST_MODEL (mechanical classification, a textbook Haiku
 * task at a fraction of the old full-HTML-on-Sonnet cost); the code half then
 * enforces what code can enforce for free: banned-term detection over the
 * actual rendered HTML (mirroring how stripEmDashes guarantees the em-dash
 * rule) and a WCAG-AA contrast spot check on the model-designed markup.
 * Non-fatal: returns empty objects if the model call fails, so a QA error
 * never blocks the draft from saving, but the code-level checks still run.
 */
async function runQaPass(
  ctx: TopicContext,
  copy: EmailCopy,
  html: string,
): Promise<{ meta: DraftMeta; seoData: DraftSeoData; usageDeltas: UsageDelta[] }> {
  const usageDeltas: UsageDelta[] = [];
  let meta: DraftMeta = {};
  let seoData: DraftSeoData = {};

  try {
    const { system, user } = buildQaMessages(ctx, copy);
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 1024,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [QA_TOOL],
      tool_choice: { type: "tool", name: "qa_review" },
    });
    logUsage("email-qa", response.usage);
    usageDeltas.push({ model: FAST_MODEL, ...response.usage });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "qa_review",
    );
    if (tu && tu.type === "tool_use") {
      const parsed = QaSchema.safeParse(tu.input);
      if (parsed.success) {
        const qa = parsed.data;
        meta = { meta_title: qa.meta_title, meta_description: qa.meta_description };
        seoData = {
          keyword_used: qa.keyword_used,
          keyword_placement: qa.keyword_placement,
          banned_terms_found: qa.banned_terms_found,
          readability_note: qa.readability_note,
          qa_pass: qa.qa_pass,
          issues: qa.issues,
        };
      } else {
        console.error("[generate] QA tool input invalid:", parsed.error.issues);
      }
    }
  } catch (err) {
    console.error("QA pass failed (non-fatal):", err);
  }

  // Code-level checks: authoritative regardless of what the model reported.
  const bannedTerms = ctx.brand.voice_profile?.banned_terms ?? [];
  const codeFound = findBannedTerms(html, bannedTerms);
  if (codeFound.length) {
    const merged = Array.from(
      new Set([...(seoData.banned_terms_found ?? []), ...codeFound]),
    );
    seoData = { ...seoData, banned_terms_found: merged, qa_pass: false };
  }

  const contrast = contrastIssues(html);
  if (contrast.length) {
    seoData = { ...seoData, issues: [...(seoData.issues ?? []), ...contrast] };
  }

  return { meta, seoData, usageDeltas };
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
  const heroImage = draftCtx.meta.hero_image;
  const { system, user } = buildEmailMessages(ctx, tokens, {
    brief,
    templateOverride: opts.templateOverride,
    heroImage,
    rejection: {
      feedback,
      previousSubject: draftCtx.content.subject,
      previousPreheader: draftCtx.content.preheader,
    },
  });

  const { parsed, usageDeltas } = await generateEmailCopy(system, user);

  const { content, copy, templateId, designSource } = renderEmailForContext(
    ctx,
    parsed,
    opts.templateOverride,
    heroImage,
  );

  const qa = await runQaPass(ctx, copy, content.html);
  usageDeltas.push(...qa.usageDeltas);
  let usage: DraftUsage | undefined;
  for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

  const meta: DraftMeta = {
    ...qa.meta,
    email_template_id: templateId,
    email_copy: copy,
    email_design_source: designSource,
    ...(heroImage ? { hero_image: heroImage } : {}),
    usage,
  };
  const seoData = qa.seoData;

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
