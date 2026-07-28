import "server-only";
import type { Anthropic } from "@anthropic-ai/sdk";
import {
  DRAFT_MODEL,
  FAST_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
import {
  getCampaign,
  getCompetitorReference,
  getDraftWithJobContext,
  getLatestDraftVersion,
  getRecentEmailStyleVariants,
  getTopicContext,
  listFeedbackEmailExamples,
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
  buildQaRevisionNudge,
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
import { ensureDarkModeReadability } from "@/lib/email/dark-mode";
import { ensureBrandLogo } from "@/lib/email/footer-logo";
import { ensureBriefPhotos } from "@/lib/email/brief-photos";
import { ensureUnsubscribeTag, validateModelEmailHtml } from "@/lib/email/validate";
import { ensureEditableRegions } from "@/lib/email/inline-style";
import type {
  CampaignBrief,
  ContentImage,
  ContentImageStyle,
  EmailCopy,
  EmailDraftContent,
  EmailTemplateId,
  EmailType,
  DraftMeta,
  DraftSeoData,
  DraftUsage,
  TopicContext,
  VisualVibe,
} from "@/lib/db/types";
import { stripEmDashes, stripMarkdown } from "@/lib/text";
import { prepareReferenceImage } from "@/lib/images/optimize";
import { contrastIssues, findBannedTerms } from "@/lib/email/quality";
import {
  generateContentImage,
  isGeminiConfigured,
  spliceHeroImage,
  useProductPhotoAsHero,
} from "./generate-image";
import {
  VISUAL_VIBE_IMAGE_STYLE,
  pickVariedImageStyle,
  resolveBrandPalette,
} from "@/prompts/generate-image";
import { chosenAngle, pickAngle } from "./pick-angle";
import { critiqueDesign } from "./critique-design";
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
    ctx.competitorRef = await resolveCompetitorRef(brief);
    const tokens = resolveBrandTokens(ctx.brand);
    // A campaign series assigns style/layout deterministically by index
    // instead of reading recent history (see seedIndex above); a single
    // email reads the brand's recent picks so it rotates away from them.
    const recent =
      opts.seedIndex === undefined
        ? await getRecentEmailStyleVariants(ctx.brand.id)
        : { styles: [], layouts: [] };
    // Thumbs the reviewer gave past emails, fed back as taste examples so
    // every rating makes the next draft better (non-fatal: [] on any error).
    const feedbackExamples = await listFeedbackEmailExamples(ctx.brand.id);

    // Decide WHAT to argue before writing it. Non-fatal: a null angle means
    // the drafting prompt is exactly what it was before this step existed.
    const strategizing = { phase: "strategizing", label: "Choosing the angle" };
    await patchDraftGeneration(draftId, strategizing);
    onEvent({ type: "phase", ...strategizing });
    const angleResult = await pickAngle(ctx, { brief, channel: "email" });
    const angle = chosenAngle(angleResult?.angle);

    await patchDraftGeneration(draftId, writing);
    onEvent({ type: "phase", ...writing });
    const { system, user, designBrief, emailType, templateId, styleId, lengthTarget } =
      buildEmailMessages(ctx, tokens, {
        brief,
        emailTypeOverride: opts.emailTypeOverride,
        seedIndex: opts.seedIndex,
        recentStyles: recent.styles,
        recentLayouts: recent.layouts,
        feedbackExamples,
        angle,
      });
    const designReference = await loadEmailDesignReference(ctx, draftId);
    const { parsed, usageDeltas } = await generateEmailCopy(system, user, {
      lengthTarget,
      emailType,
      designReference,
      brandId: ctx.brand.id,
    });

    // Hoisted into a reusable renderer so the QA revise pass below re-renders
    // the fixed draft identically, hero image and all, instead of reimplementing
    // this sequence and drifting from it.
    let heroImage: ContentImage | undefined;
    const renderWithHero = (output: EmailDraftOutput) => {
      const rendered = renderEmailForContext(ctx, output, templateId, undefined, brief);
      if (heroImage) {
        rendered.content.html =
          spliceHeroImage(rendered.content.html, heroImage) ?? rendered.content.html;
      }
      return rendered;
    };

    let { content, copy, designSource } = renderWithHero(parsed);

    // Brand-level opt-in (asked during onboarding): auto-create the hero
    // image on FIRST generation only. Regenerations keep whatever image the
    // draft already has, so a deliberately removed image never comes back.
    // Non-fatal by design: an image hiccup must never cost the whole draft.
    // Series emails skip auto imaging by default: a 10-email campaign would
    // otherwise spend 10 Gemini calls up front. Single emails and blogs keep
    // the on-by-default behavior (see maybeAutoHeroImage).
    // The chat's "want pictures?" answer, when the user gave one, beats both
    // defaults: no means no even if the brand auto-images, yes means yes even
    // if the brand opted out, and an explicit yes on a campaign overrides the
    // series cost-saving skip (skip wins inside maybeAutoHeroImage, so it must
    // be lifted here when the user opted in).
    const isSeriesEmail = Boolean(opts.briefOverride);
    const wantsImage = brief?.include_image === true;
    // Attached photos (brief.photo_urls) ARE this email's imagery: they're
    // placed by the prompt + ensureBriefPhotos, so no AI hero is conjured on
    // top of them. A product_photo_url still takes the hero slot as before
    // (photos then land inline alongside it). An AI image is always a tap
    // away on the review screen if the user wants one anyway.
    const hasAttachedPhotos = Boolean(brief?.photo_urls?.length);
    const skipImage =
      brief?.include_image === false ||
      (isSeriesEmail && !wantsImage) ||
      (hasAttachedPhotos && !brief?.product_photo_url);

    // A real product photo (the mapped product's own image, or one the user
    // uploaded in the interview) wins over AI generation: it's the actual
    // thing being sold, and it's free. Falls through to the normal AI path
    // on any fetch/optimize failure (useProductPhotoAsHero is non-fatal).
    if (!skipImage && brief?.product_photo_url) {
      const imaging = { phase: "imaging", label: "Adding your product photo" };
      await patchDraftGeneration(draftId, imaging).catch(() => {});
      onEvent({ type: "phase", ...imaging });
      heroImage = await useProductPhotoAsHero(
        brief.product_photo_url,
        copy.headline ?? ctx.topic.title,
        ctx.brand.id,
        draftId,
      );
    }
    if (!heroImage) {
      heroImage = await maybeAutoHeroImage(
        ctx,
        copy.headline,
        usageDeltas,
        { draftId, onEvent, skip: skipImage, force: wantsImage },
        {
          emailType,
          tone: brief?.tone,
          vibe: brief?.visual_vibe,
          imageStyle: brief?.image_style,
        },
      );
    }
    if (heroImage) {
      content.html = spliceHeroImage(content.html, heroImage) ?? content.html;
    }

    const checking = { phase: "checking", label: "Running quality checks" };
    await patchDraftGeneration(draftId, checking);
    onEvent({ type: "phase", ...checking });

    let qa = await runQaPass(ctx, copy, content.html, lengthTarget, emailType, brief);

    // QA found something real: fix it once before the human ever sees it.
    const revised = await reviseForQa({
      ctx,
      system,
      user,
      copyOpts: {
        lengthTarget,
        emailType,
        designReference,
        brandId: ctx.brand.id,
      },
      render: renderWithHero,
      qa,
      lengthTarget,
      emailType,
      brief,
    });
    if (revised) {
      ({ content, copy, designSource, qa } = revised);
    }

    // Last look at the finished design, after QA has settled the copy so the
    // critique judges the markup that will actually ship.
    const polishing = { phase: "polishing", label: "Polishing the design" };
    await patchDraftGeneration(draftId, polishing);
    onEvent({ type: "phase", ...polishing });
    const critique = await critiqueDesign({
      html: content.html,
      designBrief,
      designSource,
      brandId: ctx.brand.id,
    });
    if (critique) content.html = critique.html;

    usageDeltas.push(...qa.usageDeltas);
    if (angleResult) usageDeltas.push(...angleResult.usageDeltas);
    if (critique) usageDeltas.push(...critique.usageDeltas);
    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const meta: DraftMeta = {
      ...qa.meta,
      email_template_id: templateId,
      email_style_variant: styleId,
      email_type: emailType,
      email_copy: copy,
      email_design_source: designSource,
      // All three angles, not just the chosen one: a reviewer who disagrees
      // with the pick can see what else was on the table.
      ...(angleResult ? { angles: angleResult.angle } : {}),
      ...(critique
        ? { design_critique: { verdict: critique.verdict, applied: critique.applied } }
        : {}),
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
 * Fetches the newest email DESIGN reference (migration 016) and prepares it as
 * the base64 payload Claude's vision input takes, so generation can recreate
 * the design instead of only reading notes about it.
 *
 * Only the newest is used: recreation targets ONE design (see
 * buildDesignReferenceBlock, which describes that same reference in text).
 *
 * Non-fatal by design, exactly like the flyer's loadStyleReference: a deleted
 * row, an unreachable image, or an unreadable file logs a warning and the email
 * generates without the reference. A broken screenshot must never cost a draft.
 */
async function loadEmailDesignReference(
  ctx: TopicContext,
  draftId: string,
): Promise<{ data: string; mimeType: string } | null> {
  const ref = ctx.emailDesignRefs?.[0];
  if (!ref) return null;
  try {
    const res = await fetch(ref.image_url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return await prepareReferenceImage(buffer);
  } catch (err) {
    logWarn(
      "pipeline:generate:design-ref",
      err instanceof Error ? err.message : String(err),
      { draftId, styleReferenceId: ref.id },
    );
    return null;
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
 *
 * force is the per-piece "yes, I want a picture" answer from the chat: it beats
 * the brand's auto === false opt-out, but never beats skip (a series still
 * defers its images) and never conjures an image without Gemini configured.
 */
export async function maybeAutoHeroImage(
  ctx: TopicContext,
  headline: string | undefined,
  usageDeltas: UsageDelta[],
  progress?: {
    draftId: string;
    onEvent: (event: GenerationEvent) => void;
    skip?: boolean;
    force?: boolean;
  },
  emailContext?: {
    emailType?: string;
    tone?: string;
    vibe?: VisualVibe;
    /** The piece's explicit art-style choice (brief.image_style): wins over
     * the vibe mapping, the brand default, and the varied rotation. */
    imageStyle?: ContentImageStyle;
  },
): Promise<ContentImage | undefined> {
  const prefs = ctx.brand.visual_identity?.image_gen;
  const optedOut = prefs?.auto === false && !progress?.force;
  if (progress?.skip || optedOut || !isGeminiConfigured()) {
    return undefined;
  }

  if (progress) {
    const imaging = { phase: "imaging", label: "Creating your image" };
    await patchDraftGeneration(progress.draftId, imaging).catch(() => {});
    progress.onEvent({ type: "phase", ...imaging });
  }
  try {
    // Style precedence: the piece's explicit choice (the campaign form's
    // "what kind of picture" answer) → the per-piece vibe's mapped style →
    // the brand's stored default → a per-draft varied rotation. The rotation
    // replaced a hardcoded "illustration" fallback that made every no-
    // preference email hero look the same.
    const vibe = emailContext?.vibe;
    const style =
      emailContext?.imageStyle ||
      (vibe && VISUAL_VIBE_IMAGE_STYLE[vibe]) ||
      prefs?.style ||
      pickVariedImageStyle(progress?.draftId);
    const generated = await generateContentImage({
      tokens: resolveBrandTokens(ctx.brand),
      brandId: ctx.brand.id,
      draftId: progress?.draftId,
      brandName: ctx.brand.name,
      topicTitle: ctx.topic.title,
      headline,
      style,
      brandPalette: resolveBrandPalette(style, prefs?.brand_palette),
      emailType: emailContext?.emailType,
      tone: emailContext?.tone,
      vibe,
      modelTier: prefs?.model,
    });
    usageDeltas.push(...generated.usage);
    return { ...generated.image, placement: "top" };
  } catch (err) {
    logError("pipeline:generate:auto-hero-image", err);
    return undefined;
  }
}

/** Loads a campaign's brief, or null when no campaign is driving this draft. */
export async function loadCampaignBrief(
  campaignId: string | undefined | null,
): Promise<CampaignBrief | null> {
  if (!campaignId) return null;
  const campaign = await getCampaign(campaignId);
  return campaign?.brief ?? null;
}

/**
 * Resolves a brief's competitor_reference_id (migration 025) to the actual
 * saved ad, right before prompt assembly (buildEmailMessages reads
 * ctx.competitorRef the same way it reads ctx.emailDesignRefs). Non-fatal: a
 * stale id, a pre-025 DB, or a read failure all just mean no reference for
 * this draft, never a broken generation.
 */
async function resolveCompetitorRef(
  brief: CampaignBrief | null,
): Promise<TopicContext["competitorRef"]> {
  if (!brief?.competitor_reference_id) return null;
  try {
    return await getCompetitorReference(brief.competitor_reference_id);
  } catch (err) {
    logWarn("pipeline:generate:competitor-ref", String(err), {
      id: brief.competitor_reference_id,
    });
    return null;
  }
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
  opts: {
    lengthTarget?: EmailLengthTarget;
    emailType?: EmailType;
    designReference?: { data: string; mimeType: string } | null;
    /** Who pays. Generation is metered: this is the headline charged call. */
    brandId?: string;
  } = {},
): Promise<{ parsed: EmailDraftOutput; usageDeltas: UsageDelta[] }> {
  // The system prompt (brand guidelines/voice/positioning + the email design
  // system) only varies by template, of which there are three, so it's
  // identical across every topic generated with the same layout. Caching it
  // means back-to-back drafts in a session, and same-request retries below,
  // reprice at roughly a 90% discount instead of full price every time.
  const cachedSystem = cacheableSystem(system);

  // The design reference screenshot rides in the USER turn, not the system
  // prompt, so cacheableSystem still lands. Every call shape (first attempt,
  // error retry, length nudge) goes through this, so the image is never
  // silently dropped on a retry.
  const toUserContent = (
    text: string,
  ): string | Anthropic.ContentBlockParam[] => {
    const ref = opts.designReference;
    if (!ref) return text;
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: ref.mimeType as "image/jpeg" | "image/png" | "image/webp",
          data: ref.data,
        },
      },
      { type: "text", text },
    ];
  };

  // Streamed because copy + a complete designed HTML document + adaptive
  // thinking share this token budget, and the SDK requires streaming for
  // requests that could outlive its non-streaming timeout ceiling.
  const call = (u: string) =>
    getAnthropic()
      .messages.stream({
        model: DRAFT_MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        // Explicit rather than defaulted: writing + designing a full HTML
        // document in one call is the intelligence-sensitive work in this
        // pipeline, so it gets "high" on purpose instead of inheriting
        // whatever a future model default happens to be.
        output_config: { effort: "high" },
        system: cachedSystem,
        messages: [{ role: "user", content: toUserContent(u) }],
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
    logUsage(label, DRAFT_MODEL, resp.usage, {
      brandId: opts.brandId,
      metered: true,
      requestId: resp.id,
    });
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
  brief?: CampaignBrief | null,
): {
  content: EmailDraftContent;
  copy: EmailCopy;
  designSource: "model" | "template";
} {
  // Copy fields render as literal plain text (subject lines, click-to-edit
  // regions), so markdown the model slipped in would show as raw asterisks.
  // The html field is NOT markdown-stripped: ** and # are legal inside styles.
  const plain = (text: string) => stripMarkdown(stripEmDashes(text));
  const copy: EmailCopy = {
    subject: plain(parsed.subject.trim()),
    subject_variants: (parsed.subject_variants ?? [])
      .map((v) => plain(v.trim()))
      .filter((v) => v.length > 0)
      .slice(0, 3),
    preheader: plain(parsed.preheader.trim()),
    headline: plain(parsed.headline.trim()),
    body_sections: parsed.body_sections.map((s) => ({
      heading: s.heading ? plain(s.heading.trim()) : undefined,
      body: plain(s.body.trim()),
    })),
    cta_text: plain(parsed.cta_text.trim()),
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
    // The model's dark-mode CSS routinely misses elements (black text on the
    // dark card); repair coverage mechanically rather than trusting the prompt.
    // Same for the footer logo: the model is told to reuse the real uploaded
    // logo there, same as the header, but sometimes still types the
    // text-wordmark alternative it's shown for the no-logo case.
    html = ensureBrandLogo(ensureDarkModeReadability(modelHtml), tokens);
  } else {
    logWarn(
      "pipeline:generate:html-fallback",
      "model HTML failed validation or lacked dark-mode CSS; falling back to code template",
      { templateId },
    );
    designSource = "template";
    html = renderEmailTemplate(templateId, { copy, tokens });
  }
  // Region tagging runs BEFORE the unsubscribe guarantee so the fallback
  // unsubscribe <p> (appended bare, structural) never gets tagged editable.
  html = ensureUnsubscribeTag(ensureEditableRegions(stripEmDashes(html)));
  // The user's attached photos: the prompt asked the model to place every
  // one; this splices any it skipped (and covers the template fallback,
  // which knows nothing about them).
  html = ensureBriefPhotos(html, brief?.photo_urls);

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

export { MAX_DRAFT_VERSIONS } from "./constants";
// Re-exported from their new home in lib/email/validate.ts so the many call
// sites that import them from here keep working.
export { ensureUnsubscribeTag, validateModelEmailHtml };

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
  brief?: CampaignBrief | null,
): Promise<{ meta: DraftMeta; seoData: DraftSeoData; usageDeltas: UsageDelta[] }> {
  const usageDeltas: UsageDelta[] = [];
  let meta: DraftMeta = {};
  let seoData: DraftSeoData = {};

  try {
    const { system, user } = buildQaMessages(ctx, copy, brief);
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 1024,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [QA_TOOL],
      tool_choice: { type: "tool", name: "qa_review" },
    });
    logUsage("email-qa", FAST_MODEL, response.usage, {
      brandId: ctx.brand.id,
      metered: true,
      requestId: response.id,
    });
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
          ai_tells_found: qa.ai_tells_found,
          // Authoritative regardless of what the model set qa_pass to: an
          // unsupported specific or an AI tell always fails QA, same as a
          // banned term. Failing here is what triggers the revise pass.
          qa_pass:
            qa.qa_pass &&
            qa.unsupported_specifics.length === 0 &&
            qa.ai_tells_found.length === 0,
          issues: qa.unsupported_specifics.length
            ? [
                ...qa.issues,
                `Unsupported specifics (not backed by the brief or brand facts): ${qa.unsupported_specifics.join("; ")}`,
              ]
            : qa.issues,
          unsupported_specifics: qa.unsupported_specifics,
          proof_used: qa.proof_used,
          offer_terms_accurate: qa.offer_terms_accurate,
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

type QaResult = { meta: DraftMeta; seoData: DraftSeoData; usageDeltas: UsageDelta[] };

/** Everything the QA reviewer flagged, flattened for the revision record. */
function qaFailureReasons(seo: DraftSeoData): string[] {
  return [
    ...(seo.unsupported_specifics ?? []).map((s) => `Unsupported specific: "${s}"`),
    ...(seo.banned_terms_found ?? []).map((s) => `Banned term: "${s}"`),
    ...(seo.ai_tells_found ?? []).map((s) => `AI tell: "${s}"`),
    ...(seo.issues ?? []),
  ];
}

/**
 * Closes the QA loop: when the first draft fails review, writes it ONCE more
 * with the reviewer's specific findings in the prompt, then re-runs QA on the
 * result.
 *
 * Before this existed, runQaPass caught invented statistics and banned terms
 * and then did nothing with them, leaving a human to notice. The cap is one
 * revision, unconditionally: a model that can't fix its own draft in one
 * targeted pass won't fix it in three, and the reviewer still sees every
 * remaining issue on the review screen.
 *
 * Non-fatal throughout. A failed revision keeps the ORIGINAL draft and its QA,
 * because a draft that failed review still beats no draft at all.
 */
async function reviseForQa(args: {
  ctx: TopicContext;
  system: string;
  user: string;
  copyOpts: Parameters<typeof generateEmailCopy>[2];
  /** Re-renders a revised model output exactly the way the caller rendered the
   * first one (hero image splicing included), so the revision can't silently
   * lose the draft's image or design source. */
  render: (parsed: EmailDraftOutput) => {
    content: EmailDraftContent;
    copy: EmailCopy;
    designSource: "model" | "template";
  };
  qa: QaResult;
  lengthTarget?: EmailLengthTarget;
  emailType?: EmailType;
  brief?: CampaignBrief | null;
}): Promise<{
  content: EmailDraftContent;
  copy: EmailCopy;
  designSource: "model" | "template";
  qa: QaResult;
} | null> {
  const { qa, ctx } = args;
  if (qa.seoData.qa_pass !== false) return null;

  const nudge = buildQaRevisionNudge(qa.seoData);
  // qa_pass can be false on findings that carry no actionable text (a contrast
  // warning alone). Nothing to tell the model means nothing to gain.
  if (!nudge) return null;

  const fixed = qaFailureReasons(qa.seoData);
  logWarn(
    "pipeline:generate:qa-revise",
    `draft failed QA (${fixed.length} issue${fixed.length === 1 ? "" : "s"}); revising once`,
    { brandId: ctx.brand.id, topicId: ctx.topic.id },
  );

  try {
    const revision = await generateEmailCopy(args.system, args.user + nudge, args.copyOpts);
    const rendered = args.render(revision.parsed);
    const requalified = await runQaPass(
      ctx,
      rendered.copy,
      rendered.content.html,
      args.lengthTarget,
      args.emailType,
      args.brief,
    );
    return {
      ...rendered,
      qa: {
        meta: requalified.meta,
        seoData: {
          ...requalified.seoData,
          qa_revision: { fixed, resolved: requalified.seoData.qa_pass !== false },
        },
        // Both rounds are charged, so both rounds are metered.
        usageDeltas: [
          ...qa.usageDeltas,
          ...revision.usageDeltas,
          ...requalified.usageDeltas,
        ],
      },
    };
  } catch (err) {
    logError("pipeline:generate:qa-revise", err, { topicId: ctx.topic.id });
    return null;
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
  ctx.competitorRef = await resolveCompetitorRef(brief);
  const tokens = resolveBrandTokens(ctx.brand);
  const heroImage = draftCtx.meta.hero_image;
  // Reject & regenerate keeps this draft's look: reuse its stored layout and
  // style (like the hero image above) instead of rotating again. An explicit
  // opts.templateOverride (the reviewer picked a different layout in the UI)
  // still wins over the stored one. Only a FRESH generation rotates.
  const feedbackExamples = await listFeedbackEmailExamples(ctx.brand.id);
  const storedAngle = chosenAngle(draftCtx.meta.angles);
  const { system, user, emailType, templateId, styleId, lengthTarget } =
    buildEmailMessages(ctx, tokens, {
      brief,
      templateOverride: opts.templateOverride ?? draftCtx.meta.email_template_id,
      styleOverride: draftCtx.meta.email_style_variant,
      heroImage,
      emailTypeOverride: draftCtx.emailType ?? undefined,
      feedbackExamples,
      // Reuse the angle this draft was built on rather than paying for a fresh
      // strategy pass: a rejection carries explicit instructions that outrank
      // it anyway, and keeping the angle is what makes this a revision of the
      // same idea instead of an unrelated second email.
      angle: storedAngle,
      rejection: {
        feedback,
        previousSubject: draftCtx.content.subject,
        previousPreheader: draftCtx.content.preheader,
      },
    });

  const designReference = await loadEmailDesignReference(ctx, draftId);
  const { parsed, usageDeltas } = await generateEmailCopy(system, user, {
    lengthTarget,
    emailType,
    designReference,
    brandId: ctx.brand.id,
  });

  const render = (output: EmailDraftOutput) =>
    renderEmailForContext(ctx, output, templateId, heroImage, brief);

  let { content, copy, designSource } = render(parsed);

  let qa = await runQaPass(ctx, copy, content.html, lengthTarget, emailType, brief);

  // Same one-shot QA fix the fresh path gets: a human-requested regeneration
  // shouldn't be the one version that ships with invented specifics in it.
  const revised = await reviseForQa({
    ctx,
    system,
    user,
    copyOpts: { lengthTarget, emailType, designReference, brandId: ctx.brand.id },
    render,
    qa,
    lengthTarget,
    emailType,
    brief,
  });
  if (revised) {
    ({ content, copy, designSource, qa } = revised);
  }

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
    // Carried forward so the new version remembers the strategy it was written
    // against, the same way it carries its layout and style.
    ...(draftCtx.meta.angles ? { angles: draftCtx.meta.angles } : {}),
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
