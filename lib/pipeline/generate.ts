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
  getRecentEmailStyleVariants,
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
  countEmailWords,
  type EmailDraftOutput,
  type EmailLengthTarget,
} from "@/prompts/generate-email";
import { QA_TOOL, QaSchema, buildQaMessages } from "@/prompts/qa-email";
import {
  renderEmailTemplate,
  resolveBrandTokens,
} from "@/lib/email/templates";
import { hasDarkModeSupport } from "@/lib/email/preview-mode";
import type {
  CampaignBrief,
  ContentImage,
  EmailCopy,
  EmailDraftContent,
  EmailTemplateId,
  EmailType,
  DraftMeta,
  DraftSeoData,
  DraftUsage,
  TopicContext,
} from "@/lib/db/types";
import { stripEmDashes } from "@/lib/text";
import { contrastIssues, findBannedTerms } from "@/lib/email/quality";
import {
  generateContentImage,
  isGeminiConfigured,
  spliceHeroImage,
} from "./generate-image";
import { accumulateUsage, type UsageDelta } from "./cost";
import { MAX_DRAFT_VERSIONS } from "./constants";
import { logError, logWarn } from "@/lib/log";

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
  opts: {
    campaignId?: string;
    emailTypeOverride?: EmailType;
    /** Per-email brief from a plan_series draft (meta.series_brief); wins
     * over the shared campaign brief so series emails keep their own angle. */
    briefOverride?: CampaignBrief;
    /** Campaign-series position (meta.series_seed_index): makes style/layout
     * rotation deterministic and distinct-by-index across the batch, since
     * the series' per-draft generation calls run in parallel and can't
     * safely race a "recent variants" DB read against each other. */
    seedIndex?: number;
  },
  onEvent: (event: GenerationEvent) => void,
): Promise<void> {
  try {
    const writing = { phase: "writing", label: "Writing your email" };
    await patchDraftGeneration(draftId, writing);
    onEvent({ type: "phase", ...writing });

    const brief = opts.briefOverride ?? (await loadCampaignBrief(opts.campaignId));
    const tokens = resolveBrandTokens(ctx.brand);
    // A campaign series assigns style/layout deterministically by index
    // instead of reading recent history (see seedIndex above); a single
    // email reads the brand's recent picks so it rotates away from them.
    const recent =
      opts.seedIndex === undefined
        ? await getRecentEmailStyleVariants(ctx.brand.id)
        : { styles: [], layouts: [] };
    const { system, user, emailType, templateId, styleId, lengthTarget } =
      buildEmailMessages(ctx, tokens, {
        brief,
        emailTypeOverride: opts.emailTypeOverride,
        seedIndex: opts.seedIndex,
        recentStyles: recent.styles,
        recentLayouts: recent.layouts,
      });
    const { parsed, usageDeltas } = await generateEmailCopy(system, user, {
      lengthTarget,
      emailType,
    });

    const { content, copy, designSource } = renderEmailForContext(
      ctx,
      parsed,
      templateId,
    );

    // Brand-level opt-in (asked during onboarding): auto-create the hero
    // image on FIRST generation only. Regenerations keep whatever image the
    // draft already has, so a deliberately removed image never comes back.
    // Non-fatal by design: an image hiccup must never cost the whole draft.
    // Series emails skip auto imaging by default: a 10-email campaign would
    // otherwise spend 10 Gemini calls up front. Single emails and blogs keep
    // the on-by-default behavior (see maybeAutoHeroImage).
    const isSeriesEmail = Boolean(opts.briefOverride);
    const heroImage = await maybeAutoHeroImage(ctx, copy.headline, usageDeltas, {
      draftId,
      onEvent,
      skip: isSeriesEmail,
    });
    if (heroImage) {
      content.html = spliceHeroImage(content.html, heroImage) ?? content.html;
    }

    const checking = { phase: "checking", label: "Running quality checks" };
    await patchDraftGeneration(draftId, checking);
    onEvent({ type: "phase", ...checking });

    const qa = await runQaPass(ctx, copy, content.html, lengthTarget, emailType);
    usageDeltas.push(...qa.usageDeltas);
    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const meta: DraftMeta = {
      ...qa.meta,
      email_template_id: templateId,
      email_style_variant: styleId,
      email_type: emailType,
      email_copy: copy,
      email_design_source: designSource,
      ...(heroImage ? { hero_image: heroImage } : {}),
      usage,
    };
    const seoData = qa.seoData;

    await populateDraft(draftId, { content, meta, seoData, emailType });

    if (opts.campaignId) {
      // "done", not "drafted": once a draft exists, the chat's job is
      // finished (review happens on the drafts page, not back in the
      // thread). getLatestActiveCampaign only excludes "done", so anything
      // else here would keep resurrecting this same chat on every reload.
      await updateCampaign(opts.campaignId, { status: "done" });
    }

    onEvent({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    await patchDraftGeneration(draftId, { status: "error", error: message }).catch(
      (e) => logError("pipeline:generate:record-error-phase", e, { draftId }),
    );
    onEvent({ type: "error", message });
    throw err;
  }
}

/**
 * Auto-generates a hero image on by default for single emails and blogs,
 * unless the brand explicitly opted out (visual_identity.image_gen.auto ===
 * false) or the caller passes skip (series emails, to keep a multi-email
 * campaign from spending one Gemini call per email up front). Returns
 * undefined (and just logs) on any failure, when Gemini isn't configured, or
 * when skipped: the approval gate still covers the image, and the reviewer
 * can always generate, regenerate, replace, move, or remove it on the review
 * screen.
 */
export async function maybeAutoHeroImage(
  ctx: TopicContext,
  headline: string | undefined,
  usageDeltas: UsageDelta[],
  progress?: {
    draftId: string;
    onEvent: (event: GenerationEvent) => void;
    skip?: boolean;
  },
): Promise<ContentImage | undefined> {
  const prefs = ctx.brand.visual_identity?.image_gen;
  if (progress?.skip || prefs?.auto === false || !isGeminiConfigured()) {
    return undefined;
  }

  if (progress) {
    const imaging = { phase: "imaging", label: "Creating your image" };
    await patchDraftGeneration(progress.draftId, imaging).catch(() => {});
    progress.onEvent({ type: "phase", ...imaging });
  }
  try {
    const generated = await generateContentImage({
      tokens: resolveBrandTokens(ctx.brand),
      brandName: ctx.brand.name,
      topicTitle: ctx.topic.title,
      headline,
      style: prefs?.style ?? "illustration",
    });
    usageDeltas.push(...generated.usage);
    return { ...generated.image, placement: "top" };
  } catch (err) {
    logError("pipeline:generate:auto-hero-image", err);
    return undefined;
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
  opts: { lengthTarget?: EmailLengthTarget; emailType?: EmailType } = {},
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
  const call = (u: string) =>
    getAnthropic()
      .messages.stream({
        model: DRAFT_MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        system: cachedSystem,
        messages: [{ role: "user", content: u }],
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

  const runOnce = async (label: string, u: string): Promise<EmailDraftOutput> => {
    const resp = await call(u);
    logUsage(label, DRAFT_MODEL, resp.usage);
    usageDeltas.push({ model: DRAFT_MODEL, ...resp.usage });
    return extract(resp);
  };

  const usageDeltas: UsageDelta[] = [];
  let parsed: EmailDraftOutput;
  try {
    parsed = await runOnce("email-copy", user);
  } catch (err) {
    logError("pipeline:generate:email-copy", err);
    parsed = await runOnce("email-copy-retry", user);
  }

  // Length enforcement: if the draft came in under this email type's minimum
  // word count, hand the model its actual word count and the target and try
  // once more (reusing the cached system prompt). One retry only, matching the
  // existing retry posture; a still-short result is still surfaced as a QA
  // issue by runQaPass so the reviewer sees it.
  const { lengthTarget, emailType } = opts;
  if (lengthTarget) {
    const words = countEmailWords(parsed);
    if (words < lengthTarget.words[0]) {
      logWarn(
        "pipeline:generate:length-check",
        `email too short (${words} < ${lengthTarget.words[0]} for ${emailType ?? "this type"}); retrying once`,
      );
      const nudge = [
        "",
        "LENGTH CHECK: the previous draft was only " +
          words +
          " words of body copy.",
        "This email must be " +
          lengthTarget.words[0] +
          " to " +
          lengthTarget.words[1] +
          " words across " +
          lengthTarget.sections[0] +
          " to " +
          lengthTarget.sections[1] +
          " body_sections.",
        "Rewrite with more depth: expand each section with concrete examples, named specifics, and the reasoning behind the advice. Keep it tight and on-brand; do not pad with filler or repeat yourself.",
        "Reach at least " + lengthTarget.words[0] + " words this time.",
      ].join("\n");
      try {
        parsed = await runOnce("email-copy-length-retry", user + nudge);
      } catch (err) {
        logError("pipeline:generate:length-retry", err);
      }
    }
  }

  return { parsed, usageDeltas };
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
  templateId: EmailTemplateId,
  heroImage?: ContentImage,
): {
  content: EmailDraftContent;
  copy: EmailCopy;
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

  const tokens = resolveBrandTokens(ctx.brand);

  // Dark-mode CSS is gated here, at fresh generation, not inside
  // validateModelEmailHtml (that validator is shared with edit/redesign
  // flows, which shouldn't be rejected just for patching a draft that
  // predates dark-mode support). The prompt asks the model to add it, but it
  // skips it often enough in practice that this can't be prompt-only trust:
  // the light/dark preview toggle and the "always adaptive when deployed"
  // guarantee both depend on the CSS actually being there, so a model design
  // missing it falls back to the code template (which always has it via
  // renderShell) rather than persisting a draft the toggle can't act on.
  const modelHtml = validateModelEmailHtml(parsed.html);
  let designSource: "model" | "template";
  let html: string;
  if (modelHtml && hasDarkModeSupport(modelHtml)) {
    designSource = "model";
    html = modelHtml;
  } else {
    logWarn(
      "pipeline:generate:html-fallback",
      "model HTML failed validation or lacked dark-mode CSS; falling back to code template",
      { templateId },
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
    designSource,
  };
}

/**
 * Validates model-designed email HTML before it can be persisted: must be a
 * complete document and must not smuggle in script. Returns the trimmed HTML
 * or null (null → the caller falls back to the code template). Kept strict
 * and code-level, never trust the model for safety guarantees.
 *
 * Deliberately does NOT require dark-mode CSS here: this validator is shared
 * with html-edit.ts's commitHtmlEdit (every "Apply text/color/style" patch
 * re-validates the whole patched document), and a content edit isn't
 * responsible for authoring head-level dark-mode CSS. Requiring it here would
 * reject every edit on any draft that doesn't already have it. The dark-mode
 * requirement lives at the fresh-generation callsite instead (see
 * renderEmailForContext), where there's a safe template fallback.
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
  lengthTarget?: EmailLengthTarget,
  emailType?: EmailType,
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
    logUsage("email-qa", FAST_MODEL, response.usage);
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
        logError("pipeline:generate:qa-invalid", parsed.error, {
          issues: parsed.error.issues,
        });
      }
    }
  } catch (err) {
    logError("pipeline:generate:qa-pass", err);
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

  // Length check (code-level, authoritative): the prompt asks for a type-specific
  // word range and generateEmailCopy retries once if the first draft is short,
  // but the model can still miss. Surface the actual count vs. target so the
  // reviewer sees "248 / 300 words for a newsletter email" before approving.
  if (lengthTarget) {
    const words = countEmailWords(copy);
    const [min, max] = lengthTarget.words;
    const typeLabel = emailType ? `${emailType} email` : "this email type";
    if (words < min) {
      seoData = {
        ...seoData,
        issues: [
          ...(seoData.issues ?? []),
          `Length: ${words} of ${min} to ${max} words for a ${typeLabel}. Too short; expand the body with more depth.`,
        ],
      };
    } else if (words > max) {
      seoData = {
        ...seoData,
        issues: [
          ...(seoData.issues ?? []),
          `Length: ${words} words, over the ${max}-word target for a ${typeLabel}.`,
        ],
      };
    }
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
): Promise<{ newDraftId: string } | { capped: true } | { notInReview: true }> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) throw new Error(`Draft ${draftId} not found`);

  // A draft that's already approved/rejected/superseded isn't the active
  // review target anymore: rejecting it would overwrite its state (even an
  // already-approved, possibly already-published draft) purely because the
  // client-side disable was bypassed or stale. The version cap check alone
  // doesn't cover this, since an approved draft can be well under the cap.
  if (draftCtx.state !== "in_review") return { notInReview: true };

  const latestVersion = await getLatestDraftVersion(draftCtx.jobId);
  if (latestVersion >= MAX_DRAFT_VERSIONS) return { capped: true };

  // Record the rejection before generating so it's persisted even if Claude errors.
  await rejectDraftRecord(draftId, feedback);

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) throw new Error(`Topic not found for draft ${draftId}`);

  const brief =
    draftCtx.meta.series_brief ?? (await loadCampaignBrief(draftCtx.campaignId));
  const tokens = resolveBrandTokens(ctx.brand);
  const heroImage = draftCtx.meta.hero_image;
  // Reject & regenerate keeps this draft's look: reuse its stored layout and
  // style (like the hero image above) instead of rotating again. An explicit
  // opts.templateOverride (the reviewer picked a different layout in the UI)
  // still wins over the stored one. Only a FRESH generation rotates.
  const { system, user, emailType, templateId, styleId, lengthTarget } =
    buildEmailMessages(ctx, tokens, {
      brief,
      templateOverride: opts.templateOverride ?? draftCtx.meta.email_template_id,
      styleOverride: draftCtx.meta.email_style_variant,
      heroImage,
      emailTypeOverride: draftCtx.emailType ?? undefined,
      rejection: {
        feedback,
        previousSubject: draftCtx.content.subject,
        previousPreheader: draftCtx.content.preheader,
      },
    });

  const { parsed, usageDeltas } = await generateEmailCopy(system, user, {
    lengthTarget,
    emailType,
  });

  const { content, copy, designSource } = renderEmailForContext(
    ctx,
    parsed,
    templateId,
    heroImage,
  );

  const qa = await runQaPass(ctx, copy, content.html, lengthTarget, emailType);
  usageDeltas.push(...qa.usageDeltas);
  let usage: DraftUsage | undefined;
  for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

  const meta: DraftMeta = {
    ...qa.meta,
    email_template_id: templateId,
    email_style_variant: styleId,
    email_type: emailType,
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
    emailType,
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
