import "server-only";
import {
  DRAFT_MODEL,
  cacheableSystem,
  getAnthropic,
  logUsage,
} from "@/lib/clients/anthropic";
import { getCampaign, patchDraftGeneration, populateDraft } from "@/lib/db/queries";
import {
  BLOG_TOOL,
  BlogDraftSchema,
  BLOG_LENGTH_TARGETS,
  buildBlogMessages,
  countBlogWords,
  type BlogDraftOutput,
  type BlogLengthTarget,
} from "@/prompts/generate-blog";
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
import { accumulateUsage, type UsageDelta } from "./cost";
import { maybeAutoHeroImage, type GenerationEvent } from "./generate";

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
  opts: { campaignId?: string },
  onEvent: (event: GenerationEvent) => void,
): Promise<void> {
  try {
    const writing = { phase: "writing", label: "Writing your blog post" };
    await patchDraftGeneration(draftId, writing);
    onEvent({ type: "phase", ...writing });

    const brief = await loadBrief(opts.campaignId);
    const { system, user, blogType } = buildBlogMessages(ctx, { brief });
    const lengthTarget = BLOG_LENGTH_TARGETS[blogType];
    const { parsed, usageDeltas } = await generateBlogCopy(system, user, {
      lengthTarget,
      blogType,
    });

    const copy = cleanBlogCopy(parsed);

    // Brand-level opt-in: auto-create the post's hero image (first
    // generation only; non-fatal, the draft ships without one on failure).
    // Blog heroes have no placement choice; they render under the title.
    const heroImage = await maybeAutoHeroImage(ctx, copy.title, usageDeltas, {
      draftId,
      onEvent,
    });
    const html = renderBlogPreviewHtml(copy, ctx.brand, heroImage);

    const checking = { phase: "checking", label: "Running quality checks" };
    await patchDraftGeneration(draftId, checking);
    onEvent({ type: "phase", ...checking });

    const seoData = runBlogChecks(ctx, copy, html, lengthTarget, blogType);

    let usage: DraftUsage | undefined;
    for (const delta of usageDeltas) usage = accumulateUsage(usage, delta);

    const meta: DraftMeta = {
      meta_title: copy.meta_title,
      meta_description: copy.meta_description,
      blog_type: blogType,
      blog_copy: copy,
      ...(heroImage ? { hero_image: heroImage } : {}),
      usage,
    };

    await populateDraft(draftId, {
      content: { subject: copy.title, preheader: copy.meta_description, html },
      meta,
      seoData,
    });

    onEvent({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    await patchDraftGeneration(draftId, { status: "error", error: message }).catch(
      (e) => console.error("[generate-blog] failed to record error phase:", e),
    );
    onEvent({ type: "error", message });
    throw err;
  }
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
  opts: { lengthTarget?: BlogLengthTarget; blogType?: BlogType } = {},
): Promise<{ parsed: BlogDraftOutput; usageDeltas: UsageDelta[] }> {
  const cachedSystem = cacheableSystem(system);

  const call = (u: string) =>
    getAnthropic()
      .messages.stream({
        model: DRAFT_MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
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
    logUsage(label, resp.usage);
    usageDeltas.push({ model: DRAFT_MODEL, ...resp.usage });
    return extract(resp);
  };

  const usageDeltas: UsageDelta[] = [];
  let parsed: BlogDraftOutput;
  try {
    parsed = await runOnce("blog-copy", user);
  } catch (err) {
    console.error("[generate-blog] copy failed, retrying once:", err);
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
      console.warn(
        `[generate-blog] post too short (${words} < ${lengthTarget.words[0]} for ${blogType ?? "this type"}); retrying once`,
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
        console.error(
          "[generate-blog] length retry failed, keeping first draft:",
          err,
        );
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
