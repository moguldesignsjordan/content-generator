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
  listFeedbackEmailExamples,
  patchDraftGeneration,
  persistRegeneratedDraft,
  populateDraft,
  rejectDraftRecord,
  updateCampaign,
} from "@/lib/db/queries";
import {
  BLOG_TOOL,
  BlogDraftSchema,
  BLOG_LENGTH_TARGETS,
  buildBlogMessages,
  countBlogWords,
  type BlogDraftOutput,
  type BlogLengthTarget,
} from "@/prompts/generate-blog";
import {
  GROUNDING_QA_TOOL,
  GroundingQaSchema,
  buildGroundingQaMessages,
} from "@/prompts/qa-grounding";
import { buildQaRevisionNudge } from "@/prompts/generate-email";
import { renderBlogPreviewHtml } from "@/lib/blog/render-preview";
import { findBannedTerms, visibleEmailText } from "@/lib/email/quality";
import { stripEmDashes } from "@/lib/text";
import type {
  BlogCopy,
  BlogType,
  CampaignBrief,
  DraftMeta,
  DraftSeoData,
  DraftUsage,
  TopicContext,
} from "@/lib/db/types";
import { MAX_DRAFT_VERSIONS } from "./constants";
import { accumulateUsage, type UsageDelta } from "./cost";
import { maybeAutoHeroImage, type GenerationEvent } from "./generate";
import { chosenAngle, pickAngle } from "./pick-angle";
import { logError, logWarn } from "@/lib/log";

/**
 * Fills in a blog draft shell (content_jobs.type='blog'), mirroring
 * generateEmailForTopicStreamed's shell → writing → checking → done phases so
 * the SSE route and progress UI work unchanged. The draft's `content` stores
 * the EmailDraftContent SHAPE (subject = title, preheader = meta_description,
 * html = the article preview rendered from the SAME Portable Text that
 * publishing sends to Sanity); the structured post lives in meta.blog_copy.
 */
export async function generateBlogForTopicStreamed(
  draftId: string,
  ctx: TopicContext,
  opts: { campaignId?: string; blogTypeOverride?: BlogType },
  onEvent: (event: GenerationEvent) => void,
): Promise<void> {
  try {
    const writing = { phase: "writing", label: "Writing your blog post" };
    await patchDraftGeneration(draftId, writing);
    onEvent({ type: "phase", ...writing });

    const brief = await loadBrief(opts.campaignId);

    // Decide what the post should argue before writing it. Non-fatal: a null
    // angle leaves the prompt exactly as it was before this step existed.
    const strategizing = { phase: "strategizing", label: "Choosing the angle" };
    await patchDraftGeneration(draftId, strategizing);
    onEvent({ type: "phase", ...strategizing });
    const angleResult = await pickAngle(ctx, { brief, channel: "blog" });
    const angle = chosenAngle(angleResult?.angle);

    await patchDraftGeneration(draftId, writing);
    onEvent({ type: "phase", ...writing });

    // Thumbs the reviewer gave past POSTS (not emails): blogs were generating
    // with no taste history at all before this.
    const feedbackExamples = await listFeedbackEmailExamples(ctx.brand.id, 3, "blog");
    const { system, user, blogType } = buildBlogMessages(ctx, {
      brief,
      blogTypeOverride: opts.blogTypeOverride,
      angle,
      feedbackExamples,
    });
    const lengthTarget = BLOG_LENGTH_TARGETS[blogType];
    const { parsed, usageDeltas } = await generateBlogCopy(system, user, {
      lengthTarget,
      blogType,
      brandId: ctx.brand.id,
    });

    let copy = cleanBlogCopy(parsed);

    // Brand-level opt-in: auto-create the post's hero image (first
    // generation only; non-fatal, the draft ships without one on failure).
    // Blog heroes have no placement choice; they render under the title.
    const heroImage = await maybeAutoHeroImage(ctx, copy.title, usageDeltas, {
      draftId,
      onEvent,
    });
    const render = (output: BlogDraftOutput) => {
      const revised = cleanBlogCopy(output);
      return { copy: revised, html: renderBlogPreviewHtml(revised, ctx.brand, heroImage) };
    };
    let html = renderBlogPreviewHtml(copy, ctx.brand, heroImage);

    const checking = { phase: "checking", label: "Running quality checks" };
    await patchDraftGeneration(draftId, checking);
    onEvent({ type: "phase", ...checking });

    const checked = await qaBlogWithRevision({
      ctx,
      system,
      user,
      copyOpts: { lengthTarget, blogType, brandId: ctx.brand.id },
      copy,
      html,
      render,
      brief,
      lengthTarget,
      blogType,
    });
    ({ copy, html } = checked);
    const seoData = checked.seoData;
    usageDeltas.push(...checked.usageDeltas);

    if (angleResult) usageDeltas.push(...angleResult.usageDeltas);

    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const meta: DraftMeta = {
      meta_title: copy.meta_title,
      meta_description: copy.meta_description,
      ...(angleResult ? { angles: angleResult.angle } : {}),
      blog_type: blogType,
      blog_copy: copy,
      ...(heroImage ? { hero_image: heroImage } : {}),
      usage,
    };

    await populateDraft(draftId, {
      content: { subject: copy.title, preheader: copy.meta_description, html },
      meta,
      seoData,
      blogType,
    });

    if (opts.campaignId) {
      // Mirrors generateEmailForTopicStreamed: once a draft exists the
      // campaign's job is done, so the dashboard chat doesn't resurrect this
      // same thread on the next reload (getLatestActiveCampaign only
      // excludes "done"). Blog generation never set this at all before.
      await updateCampaign(opts.campaignId, { status: "done" });
    }

    onEvent({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    await patchDraftGeneration(draftId, { status: "error", error: message }).catch(
      (e) => logError("pipeline:generate-blog:record-error-phase", e, { draftId }),
    );
    onEvent({ type: "error", message });
    throw err;
  }
}

/**
 * Rejects the current blog draft and regenerates a new version with the
 * reviewer's feedback woven into the prompt. Mirrors regenerateEmailDraft
 * (lib/pipeline/generate.ts): same version cap, same "not the active review
 * target anymore" guard, same rejection-record-before-generating ordering.
 * The existing hero image (if any) carries over unchanged, same as a
 * regenerated email keeps its hero.
 */
export async function regenerateBlogDraft(
  draftId: string,
  feedback: string,
): Promise<{ newDraftId: string } | { capped: true } | { notInReview: true }> {
  const draftCtx = await getDraftWithJobContext(draftId);
  if (!draftCtx) throw new Error(`Draft ${draftId} not found`);

  if (draftCtx.state !== "in_review") return { notInReview: true };

  const latestVersion = await getLatestDraftVersion(draftCtx.jobId);
  if (latestVersion >= MAX_DRAFT_VERSIONS) return { capped: true };

  await rejectDraftRecord(draftId, feedback);

  const ctx = await getTopicContext(draftCtx.topicId);
  if (!ctx) throw new Error(`Topic not found for draft ${draftId}`);

  const brief = draftCtx.meta.series_brief ?? (await loadBrief(draftCtx.campaignId));
  const feedbackExamples = await listFeedbackEmailExamples(ctx.brand.id, 3, "blog");
  const { system, user, blogType } = buildBlogMessages(ctx, {
    brief,
    feedbackExamples,
    blogTypeOverride: draftCtx.blogType ?? undefined,
    // Same reasoning as the email path: reuse the angle this post was built
    // on, since the rejection feedback already outranks it.
    angle: chosenAngle(draftCtx.meta.angles),
    rejection: {
      feedback,
      previousTitle: draftCtx.content.subject,
      previousMetaDescription: draftCtx.content.preheader,
    },
  });
  const lengthTarget = BLOG_LENGTH_TARGETS[blogType];

  const { parsed, usageDeltas } = await generateBlogCopy(system, user, {
    lengthTarget,
    blogType,
    brandId: ctx.brand.id,
  });
  let copy = cleanBlogCopy(parsed);

  const heroImage = draftCtx.meta.hero_image;
  const render = (output: BlogDraftOutput) => {
    const revised = cleanBlogCopy(output);
    return { copy: revised, html: renderBlogPreviewHtml(revised, ctx.brand, heroImage) };
  };
  let html = renderBlogPreviewHtml(copy, ctx.brand, heroImage);

  const checked = await qaBlogWithRevision({
    ctx,
    system,
    user,
    copyOpts: { lengthTarget, blogType, brandId: ctx.brand.id },
    copy,
    html,
    render,
    brief,
    lengthTarget,
    blogType,
  });
  ({ copy, html } = checked);
  const seoData = checked.seoData;
  usageDeltas.push(...checked.usageDeltas);

  let usage: DraftUsage | undefined;
  for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

  const meta: DraftMeta = {
    meta_title: copy.meta_title,
    meta_description: copy.meta_description,
    // Carried forward like the hero image and the source link: the new version
    // is a revision of the same strategy, so it keeps the same angle record.
    ...(draftCtx.meta.angles ? { angles: draftCtx.meta.angles } : {}),
    blog_type: blogType,
    blog_copy: copy,
    ...(heroImage ? { hero_image: heroImage } : {}),
    ...(draftCtx.meta.source_draft_id
      ? { source_draft_id: draftCtx.meta.source_draft_id }
      : {}),
    usage,
  };

  const newDraftId = await persistRegeneratedDraft({
    jobId: draftCtx.jobId,
    version: latestVersion + 1,
    content: { subject: copy.title, preheader: copy.meta_description, html },
    meta,
    seoData,
    blogType,
  });

  return { newDraftId };
}

async function loadBrief(
  campaignId: string | undefined | null,
): Promise<CampaignBrief | null> {
  if (!campaignId) return null;
  const campaign = await getCampaign(campaignId);
  return campaign?.brief ?? null;
}

/**
 * Calls Claude for structured blog copy via FORCED TOOL USE with one retry,
 * the same reliable pattern as generateEmailCopy. Streamed because a full
 * post + adaptive thinking share the token budget.
 */
async function generateBlogCopy(
  system: string,
  user: string,
  opts: {
    lengthTarget?: BlogLengthTarget;
    blogType?: BlogType;
    /** Who pays. Generation is metered. */
    brandId?: string;
  } = {},
): Promise<{ parsed: BlogDraftOutput; usageDeltas: UsageDelta[] }> {
  const cachedSystem = cacheableSystem(system);

  const call = (u: string) =>
    getAnthropic()
      .messages.stream({
        model: DRAFT_MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        // Same reasoning as the email path: set explicitly, not inherited.
        output_config: { effort: "high" },
        system: cachedSystem,
        messages: [{ role: "user", content: u }],
        tools: [BLOG_TOOL],
        tool_choice: { type: "tool", name: "save_blog_draft" },
      })
      .finalMessage();

  const extract = (resp: Awaited<ReturnType<typeof call>>): BlogDraftOutput => {
    const tu = resp.content.find(
      (b) => b.type === "tool_use" && b.name === "save_blog_draft",
    );
    if (!tu || tu.type !== "tool_use") {
      const preview = JSON.stringify(resp.content).slice(0, 800);
      throw new Error(
        `Model did not call save_blog_draft. Stop reason: ${resp.stop_reason}. Raw content: ${preview}`,
      );
    }
    const parsed = BlogDraftSchema.safeParse(tu.input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid blog copy from tool: ${issues}`);
    }
    return parsed.data;
  };

  const runOnce = async (label: string, u: string): Promise<BlogDraftOutput> => {
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
  let parsed: BlogDraftOutput;
  try {
    parsed = await runOnce("blog-copy", user);
  } catch (err) {
    logError("pipeline:generate-blog:copy", err);
    parsed = await runOnce("blog-copy-retry", user);
  }

  // Length enforcement: if the post came in under this format's minimum word
  // count, hand the model its actual count and the target and try once more
  // (reusing the cached system prompt). One retry only; a still-short result is
  // still surfaced as a QA issue by runBlogChecks. Mirrors the email path.
  const { lengthTarget, blogType } = opts;
  if (lengthTarget) {
    const words = countBlogWords(parsed);
    if (words < lengthTarget.words[0]) {
      logWarn(
        "pipeline:generate-blog:length-check",
        `post too short (${words} < ${lengthTarget.words[0]} for ${blogType ?? "this type"}); retrying once`,
      );
      const nudge = [
        "",
        "LENGTH CHECK: the previous draft was only " + words + " words.",
        "This post must be " +
          lengthTarget.words[0] +
          " to " +
          lengthTarget.words[1] +
          " words across " +
          lengthTarget.sections[0] +
          " to " +
          lengthTarget.sections[1] +
          " sections.",
        "Rewrite with more depth: add concrete examples, named specifics, step-by-step detail, and the reasoning behind each point. Keep it tight and on-brand; do not pad with filler or repeat yourself.",
        "Reach at least " + lengthTarget.words[0] + " words this time.",
      ].join("\n");
      try {
        parsed = await runOnce("blog-copy-length-retry", user + nudge);
      } catch (err) {
        logError("pipeline:generate-blog:length-retry", err);
      }
    }
  }

  return { parsed, usageDeltas };
}

/** Em-dash stripping + trimming across every text field, mirroring the email path. */
function cleanBlogCopy(parsed: BlogDraftOutput): BlogCopy {
  return {
    title: stripEmDashes(parsed.title.trim()),
    slug: parsed.slug,
    meta_title: stripEmDashes(parsed.meta_title.trim()),
    meta_description: stripEmDashes(parsed.meta_description.trim()),
    intro: stripEmDashes(parsed.intro.trim()),
    sections: parsed.sections.map((s) => ({
      heading: stripEmDashes(s.heading.trim()),
      body: stripEmDashes(s.body.trim()),
    })),
    conclusion: stripEmDashes(parsed.conclusion.trim()),
    cta_text: stripEmDashes(parsed.cta_text.trim()),
    cta_url: parsed.cta_url?.trim() || undefined,
  };
}

/**
 * Runs the full blog QA gate: code checks + model audit, then ONE targeted
 * rewrite when the post failed, then re-checks the rewrite. The email path's
 * reviseForQa in the same shape; see that function for why the cap is one.
 */
async function qaBlogWithRevision(args: {
  ctx: TopicContext;
  system: string;
  user: string;
  copyOpts: Parameters<typeof generateBlogCopy>[2];
  copy: BlogCopy;
  html: string;
  /** Re-renders a revised post the way the caller rendered the first one, so
   * the revision keeps the draft's hero image. */
  render: (parsed: BlogDraftOutput) => { copy: BlogCopy; html: string };
  brief?: CampaignBrief | null;
  lengthTarget?: BlogLengthTarget;
  blogType?: BlogType;
}): Promise<{
  copy: BlogCopy;
  html: string;
  seoData: DraftSeoData;
  usageDeltas: UsageDelta[];
}> {
  const { ctx, copy, html, brief, lengthTarget, blogType } = args;

  const audit = async (c: BlogCopy, h: string) => {
    const model = await runBlogGroundingQa(ctx, c, brief);
    const code = runBlogChecks(ctx, c, h, lengthTarget, blogType);
    return { seoData: mergeBlogQa(code, model.seoData), usageDeltas: model.usageDeltas };
  };

  const first = await audit(copy, html);
  const nudge = buildQaRevisionNudge(first.seoData, "blog post");
  if (first.seoData.qa_pass !== false || !nudge) {
    return { copy, html, seoData: first.seoData, usageDeltas: first.usageDeltas };
  }

  const fixed = [
    ...(first.seoData.unsupported_specifics ?? []).map((s) => `Unsupported specific: "${s}"`),
    ...(first.seoData.banned_terms_found ?? []).map((s) => `Banned term: "${s}"`),
    ...(first.seoData.ai_tells_found ?? []).map((s) => `AI tell: "${s}"`),
    ...(first.seoData.issues ?? []),
  ];
  logWarn(
    "pipeline:generate-blog:qa-revise",
    `blog draft failed QA (${fixed.length} issue${fixed.length === 1 ? "" : "s"}); revising once`,
    { brandId: ctx.brand.id, topicId: ctx.topic.id },
  );

  try {
    const revision = await generateBlogCopy(args.system, args.user + nudge, args.copyOpts);
    const rendered = args.render(revision.parsed);
    const second = await audit(rendered.copy, rendered.html);
    return {
      ...rendered,
      seoData: {
        ...second.seoData,
        qa_revision: { fixed, resolved: second.seoData.qa_pass !== false },
      },
      usageDeltas: [
        ...first.usageDeltas,
        ...revision.usageDeltas,
        ...second.usageDeltas,
      ],
    };
  } catch (err) {
    logError("pipeline:generate-blog:qa-revise", err, { topicId: ctx.topic.id });
    return { copy, html, seoData: first.seoData, usageDeltas: first.usageDeltas };
  }
}

/** The article as plain prose, for checks that audit claims rather than markup. */
function blogPlainText(copy: BlogCopy): string {
  return [
    copy.title,
    copy.intro,
    ...copy.sections.map((s) => `${s.heading}\n${s.body}`),
    copy.conclusion,
    copy.cta_text,
  ].join("\n\n");
}

/**
 * The model half of blog QA: invented specifics and AI tells, the two things
 * code cannot check. Blogs had no model QA at all before this, which meant a
 * post could publish a made-up statistic to Sanity with a green Quality check
 * next to it.
 *
 * Non-fatal: a failed call returns no findings and the code-level checks in
 * runBlogChecks still stand on their own, exactly as they did before.
 */
async function runBlogGroundingQa(
  ctx: TopicContext,
  copy: BlogCopy,
  brief?: CampaignBrief | null,
): Promise<{ seoData: DraftSeoData; usageDeltas: UsageDelta[] }> {
  const usageDeltas: UsageDelta[] = [];
  try {
    const { system, user } = buildGroundingQaMessages(ctx, blogPlainText(copy), brief);
    const response = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 1024,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: user }],
      tools: [GROUNDING_QA_TOOL],
      tool_choice: { type: "tool", name: "grounding_review" },
    });
    logUsage("blog-qa", FAST_MODEL, response.usage, {
      brandId: ctx.brand.id,
      metered: true,
      requestId: response.id,
    });
    usageDeltas.push({ model: FAST_MODEL, ...response.usage });

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "grounding_review",
    );
    if (!tu || tu.type !== "tool_use") return { seoData: {}, usageDeltas };

    const parsed = GroundingQaSchema.safeParse(tu.input);
    if (!parsed.success) {
      logError("pipeline:generate-blog:qa-invalid", parsed.error, {
        issues: parsed.error.issues,
      });
      return { seoData: {}, usageDeltas };
    }
    const qa = parsed.data;
    return {
      seoData: {
        unsupported_specifics: qa.unsupported_specifics,
        ai_tells_found: qa.ai_tells_found,
        issues: qa.issues,
      },
      usageDeltas,
    };
  } catch (err) {
    logError("pipeline:generate-blog:qa-pass", err);
    return { seoData: {}, usageDeltas };
  }
}

/**
 * Merges the code checks with the model audit into one verdict. The code
 * findings stay authoritative (they're deterministic); the model findings can
 * only ever ADD a reason to fail, never clear one.
 */
function mergeBlogQa(code: DraftSeoData, model: DraftSeoData): DraftSeoData {
  const unsupported = model.unsupported_specifics ?? [];
  const tells = model.ai_tells_found ?? [];
  const issues = [...(code.issues ?? []), ...(model.issues ?? [])];
  return {
    ...code,
    issues,
    ...(unsupported.length ? { unsupported_specifics: unsupported } : {}),
    ...(tells.length ? { ai_tells_found: tells } : {}),
    qa_pass: code.qa_pass !== false && unsupported.length === 0 && tells.length === 0,
  };
}

/**
 * Code-level QA for blog drafts, zero model cost: banned-term scan over the
 * rendered article and keyword-placement-where-it-counts (title, first 100
 * words, a section heading). Non-fatal by design; results surface in the
 * review screen's Quality check card and gate approve like email drafts.
 */
function runBlogChecks(
  ctx: TopicContext,
  copy: BlogCopy,
  html: string,
  lengthTarget?: BlogLengthTarget,
  blogType?: BlogType,
): DraftSeoData {
  const issues: string[] = [];

  const bannedTerms = ctx.brand.voice_profile?.banned_terms ?? [];
  const found = findBannedTerms(html, bannedTerms);

  const keyword = ctx.topic.target_keyword?.trim().toLowerCase() ?? "";
  let keywordUsed: boolean | undefined;
  let placement = "";
  if (keyword) {
    const inTitle = copy.title.toLowerCase().includes(keyword);
    const first100 = visibleEmailText(copy.intro)
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 100)
      .join(" ");
    const inIntro = first100.includes(keyword);
    const inHeading = copy.sections.some((s) =>
      s.heading.toLowerCase().includes(keyword),
    );
    keywordUsed = inTitle || inIntro || inHeading;
    const spots = [
      inTitle ? "title" : null,
      inIntro ? "first 100 words" : null,
      inHeading ? "a section heading" : null,
    ].filter(Boolean);
    placement = spots.length ? `in the ${spots.join(", ")}` : "not placed where it counts";
    if (!inTitle) issues.push("Target keyword is missing from the title.");
    if (!inIntro) issues.push("Target keyword is missing from the first 100 words.");
    if (!inHeading) issues.push("Target keyword is missing from every section heading.");
  }

  if (copy.meta_title.length > 60) {
    issues.push(`Page title is ${copy.meta_title.length} characters; keep it under 60.`);
  }
  if (copy.meta_description.length > 170) {
    issues.push(
      `Page summary is ${copy.meta_description.length} characters; keep it under 160.`,
    );
  }

  // Length check: the prompt asks for a type-specific word range and
  // generateBlogCopy retries once if the first draft is short, but the model
  // can still miss. Surface the actual count vs. target so the reviewer sees it
  // before approving (and before publishing a thin post to Sanity/SEO).
  if (lengthTarget) {
    const words = countBlogWords(copy);
    const [min, max] = lengthTarget.words;
    const typeLabel = blogType ? `${blogType.replace(/_/g, " ")} post` : "this post type";
    if (words < min) {
      issues.push(
        `Length: ${words} of ${min} to ${max} words for a ${typeLabel}. Too short; add depth, examples, and step-by-step detail.`,
      );
    } else if (words > max) {
      issues.push(
        `Length: ${words} words, over the ${max}-word target for a ${typeLabel}.`,
      );
    }
  }

  return {
    ...(keyword ? { keyword_used: keywordUsed, keyword_placement: placement } : {}),
    banned_terms_found: found,
    qa_pass: found.length === 0 && issues.length === 0 && keywordUsed !== false,
    issues,
  };
}
