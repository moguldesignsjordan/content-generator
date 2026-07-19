import "server-only";
import { getAdminClient } from "./client";
import { isMissingColumnError, isMissingTableError } from "./table-guard";
import { logError, logWarn } from "@/lib/log";
import type {
  AppLog,
  AppLogLevel,
  Brand,
  BrandBilling,
  BrandGuidelines,
  BrandMemory,
  Cadence,
  Campaign,
  CampaignBrief,
  CampaignChatState,
  CampaignPublishProgress,
  CampaignStatus,
  CompetitorProfile,
  CompetitorReference,
  ContentJobType,
  ContentSchedule,
  DraftFeedback,
  DraftForReview,
  DraftGenerationState,
  DraftJobContext,
  DraftListRow,
  DraftMeta,
  DraftSeoData,
  EmailCopy,
  EmailDraftContent,
  EmailStyleId,
  EmailTemplateId,
  EmailType,
  BlogType,
  FeedbackEmailExample,
  FlyerAspect,
  FlyerStyleId,
  EmailDesignProfile,
  StyleReference,
  StyleReferenceKind,
  StyleReferenceMode,
  Icp,
  UserRole,
  IcpProfile,
  KeywordData,
  MailerliteConfig,
  MediaAsset,
  MediaAssetKind,
  MediaAssetSource,
  OnboardingState,
  PerformanceMetric,
  PillarWithClusters,
  PlanCode,
  Positioning,
  Product,
  PromptLog,
  PromptLogSummary,
  PublicationRecord,
  ReferenceEmail,
  ReferenceEmailStyleProfile,
  BrandIntegration,
  SeoDefaults,
  Strategy,
  Topic,
  TopicContext,
  TopicFormData,
  VisualIdentity,
  VoiceProfile,
} from "./types";

/**
 * Loads the given user's brand strategy tree for the dashboard: pillars →
 * clusters → topics (spokes). One round-trip via Supabase's nested select.
 *
 * Returns null if the user has no brand yet (they should onboard).
 */
export async function getBrandStrategy(userId: string): Promise<{
  brand: Brand;
  strategy: Strategy;
  pillars: PillarWithClusters[];
  latestDraftByTopic: Record<string, { id: string; state: string; version: number }>;
} | null> {
  const brand = await getBrandForUser(userId);
  if (!brand) return null;

  const db = getAdminClient();

  const { data: strategy, error: stratErr } = await db
    .from("strategies")
    .select("*")
    .eq("brand_id", brand.id)
    .maybeSingle();
  if (stratErr) throw stratErr;
  if (!strategy) return null;

  const { data: pillars, error: pillarErr } = await db
    .from("pillars")
    .select(
      `*,
       clusters (
         *,
         topics ( * )
       )`,
    )
    .eq("strategy_id", strategy.id)
    .order("name", { ascending: true });
  if (pillarErr) throw pillarErr;

  // Load the latest draft per topic so the dashboard can show review links.
  const topicIds = (pillars ?? []).flatMap((p: PillarWithClusters) =>
    p.clusters.flatMap((c) => c.topics.map((t) => t.id)),
  );

  let latestDraftByTopic: Record<string, { id: string; state: string; version: number }> = {};
  if (topicIds.length > 0) {
    const { data: jobs } = await db
      .from("content_jobs")
      .select(`topic_id, drafts(id, state, version)`)
      .in("topic_id", topicIds)
      .eq("type", "email");

    (jobs ?? []).forEach((job) => {
      const tid = job.topic_id as string;
      const drafts = (job as { drafts?: { id: string; state: string; version: number }[] }).drafts ?? [];
      const latest = drafts.sort((a, b) => b.version - a.version)[0];
      if (latest && (!latestDraftByTopic[tid] || latest.version > latestDraftByTopic[tid].version)) {
        latestDraftByTopic[tid] = latest;
      }
    });
  }

  return {
    brand: brand as Brand,
    strategy: strategy as Strategy,
    pillars: (pillars ?? []) as PillarWithClusters[],
    latestDraftByTopic,
  };
}

/**
 * Assembles everything the generate pipeline needs for one topic:
 * topic → cluster → pillar → strategy → brand, plus the primary ICP.
 * Walked in steps rather than one nested select so a missing link is easy to
 * pinpoint. Returns null if the topic doesn't exist.
 */
export async function getTopicContext(
  topicId: string,
): Promise<TopicContext | null> {
  const db = getAdminClient();

  const { data: topic, error: topicErr } = await db
    .from("topics")
    .select("*")
    .eq("id", topicId)
    .maybeSingle();
  if (topicErr) throw topicErr;
  if (!topic) return null;

  const { data: cluster, error: clusterErr } = await db
    .from("clusters")
    .select("pillar_id")
    .eq("id", topic.cluster_id)
    .single();
  if (clusterErr) throw clusterErr;

  const { data: pillar, error: pillarErr } = await db
    .from("pillars")
    .select("strategy_id")
    .eq("id", cluster.pillar_id)
    .single();
  if (pillarErr) throw pillarErr;

  const { data: strategy, error: stratErr } = await db
    .from("strategies")
    .select("*")
    .eq("id", pillar.strategy_id)
    .single();
  if (stratErr) throw stratErr;

  const { data: brand, error: brandErr } = await db
    .from("brands")
    .select("*")
    .eq("id", strategy.brand_id)
    .single();
  if (brandErr) throw brandErr;

  // Prefer the primary ICP; fall back to any ICP on the strategy.
  const { data: icps, error: icpErr } = await db
    .from("icps")
    .select("*")
    .eq("strategy_id", strategy.id)
    .order("is_primary", { ascending: false })
    .limit(1);
  if (icpErr) throw icpErr;

  // Resolve the topic's product slug to a real offer so the prompt can pitch
  // something concrete. Missing row is fine (product stays null), and a
  // missing table (migration 002 not applied yet) degrades instead of
  // breaking generation.
  let product: Product | null = null;
  if (topic.maps_to_product) {
    const { data: productRow, error: productErr } = await db
      .from("products")
      .select("*")
      .eq("brand_id", brand.id)
      .eq("slug", topic.maps_to_product)
      .maybeSingle();
    if (productErr && !isMissingTableError(productErr)) throw productErr;
    if (productErr) {
      logWarn(
        "db:queries:topic-context",
        "products table missing, apply db/migrations/002 to enable offer context",
      );
    }
    product = (productRow as Product) ?? null;
  }

  // The reference email library steers every email's style, and the email
  // design library steers its layout. A pre-migration-015/016 DB just means an
  // empty library, never a broken generation.
  const [referenceEmails, emailDesignRefs] = await Promise.all([
    listReferenceEmails(brand.id),
    listStyleReferences(brand.id, "email"),
  ]);

  return {
    topic: topic as Topic,
    brand: brand as Brand,
    strategy: strategy as Strategy,
    primaryIcp: (icps?.[0] as Icp) ?? null,
    product,
    referenceEmails,
    emailDesignRefs,
  };
}

/**
 * Persists a generated email as draft v1: creates a content_jobs row, a drafts
 * row (state in_review), and marks the topic in_progress. Returns the draft id.
 */
/**
 * Inserts an empty draft "shell" fast, so the caller can navigate to the
 * review screen immediately (Phase 1: honest generation wait). The shell has
 * empty content and meta.generation = { status: "generating" }; the pipeline
 * fills it in later via patchDraftGeneration (phase updates) and
 * populateDraft (the finished content).
 */
export async function createDraftShell(args: {
  ctx: TopicContext;
  campaignId?: string;
  type?: ContentJobType;
  /** For blog drafts spun off an email: the source email draft id, stashed in
   * meta.source_draft_id so the blog can link back. No-op for emails. */
  sourceDraftId?: string;
  /** Sets content_jobs.email_type/blog_type up front, overriding derivation
   * for this job (see migration 005). Left unset, the column stays null until
   * generation backfills it with the resolved type. */
  emailType?: EmailType;
  blogType?: BlogType;
  /** Overrides the derived campaign/manual trigger_source. Set by the cron
   * path (lib/pipeline/run-schedule.ts) so scheduled drafts are attributable
   * and countable (see countScheduledAwaitingReview) without a schema enum. */
  triggerSource?: "schedule";
  /** Per-email brief for a draft created as one item of a multi-email series
   * (plan_series); stored in meta.series_brief and preferred over the shared
   * campaign brief at generation time. */
  seriesBrief?: CampaignBrief;
  /** This draft's position (0-based) within its plan_series batch. Stored in
   * meta.series_seed_index so the parallel per-draft generation calls assign
   * distinct email style/layout by index instead of racing a "recent
   * variants" DB read. */
  seriesSeedIndex?: number;
  /** Social flyer inputs (type='social' only), stashed in meta so the flyer
   * pipeline (lib/pipeline/generate-flyer.ts) picks them up at generation
   * time, the same way series_brief travels. */
  flyerAspect?: FlyerAspect;
  flyerBrief?: string;
  styleReferenceId?: string;
  flyerStyle?: FlyerStyleId;
}): Promise<string> {
  const db = getAdminClient();
  const {
    ctx,
    campaignId,
    type = "email",
    sourceDraftId,
    emailType,
    blogType,
    triggerSource,
    seriesBrief,
    seriesSeedIndex,
    flyerAspect,
    flyerBrief,
    styleReferenceId,
    flyerStyle,
  } = args;

  // campaign_id only when a campaign drove the draft, so plain generation
  // still works before migration 002 adds the column.
  const { data: job, error: jobErr } = await db
    .from("content_jobs")
    .insert({
      brand_id: ctx.brand.id,
      topic_id: ctx.topic.id,
      type,
      status: "generating",
      trigger_source: triggerSource ?? (campaignId ? "campaign" : "manual"),
      ...(campaignId ? { campaign_id: campaignId } : {}),
      ...(emailType ? { email_type: emailType } : {}),
      ...(blogType ? { blog_type: blogType } : {}),
    })
    .select("id")
    .single();
  if (jobErr) throw jobErr;

  const generation: DraftGenerationState = {
    status: "generating",
    phase: "queued",
    label: "Starting",
    started_at: new Date().toISOString(),
  };

  const meta: DraftMeta = {
    generation,
    ...(sourceDraftId ? { source_draft_id: sourceDraftId } : {}),
    ...(seriesBrief ? { series_brief: seriesBrief } : {}),
    ...(seriesSeedIndex !== undefined ? { series_seed_index: seriesSeedIndex } : {}),
    ...(flyerAspect ? { flyer_aspect: flyerAspect } : {}),
    ...(flyerBrief ? { flyer_brief: flyerBrief } : {}),
    ...(styleReferenceId ? { style_reference_id: styleReferenceId } : {}),
    ...(flyerStyle ? { flyer_style: flyerStyle } : {}),
  };

  const { data: draft, error: draftErr } = await db
    .from("drafts")
    .insert({
      job_id: job.id,
      version: 1,
      content: {},
      meta,
      state: "in_review",
    })
    .select("id")
    .single();
  if (draftErr) throw draftErr;

  const { error: topicErr } = await db
    .from("topics")
    .update({ status: "in_progress" })
    .eq("id", ctx.topic.id);
  if (topicErr) throw topicErr;

  return draft.id as string;
}

/**
 * Reads the style/layout of the most recent email drafts for a brand (newest
 * first), so a fresh generation can rotate away from what was just used. Used
 * only for single (non-series) generations: campaign series threads a
 * deterministic seedIndex instead, since its per-draft generation calls run
 * in parallel and would otherwise race this same read against each other
 * before any of them has persisted. Never throws: a read failure just means
 * the caller falls back to an unconstrained rotation pick.
 */
export async function getRecentEmailStyleVariants(
  brandId: string,
  limit = 5,
): Promise<{ styles: EmailStyleId[]; layouts: EmailTemplateId[] }> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("drafts")
    .select(`meta, created_at, content_jobs!inner ( brand_id, type )`)
    .eq("content_jobs.brand_id", brandId)
    .eq("content_jobs.type", "email")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logWarn("db:getRecentEmailStyleVariants", error.message, { brandId });
    return { styles: [], layouts: [] };
  }

  const styles: EmailStyleId[] = [];
  const layouts: EmailTemplateId[] = [];
  for (const row of (data ?? []) as { meta: DraftMeta | null }[]) {
    const meta = row.meta ?? {};
    if (meta.email_style_variant) styles.push(meta.email_style_variant);
    if (meta.email_template_id) layouts.push(meta.email_template_id);
  }
  return { styles, layouts };
}

/**
 * Fills in a draft shell with its finished content, merging over
 * meta.generation so the record reads "ready". Also flips the parent
 * content_job's status out of "generating".
 */
export async function populateDraft(
  draftId: string,
  args: {
    content: EmailDraftContent;
    meta?: DraftMeta;
    seoData?: DraftSeoData;
    /** Backfills content_jobs.email_type/blog_type with the type this
     * generation resolved to (derived, or an honored override), so the
     * column is always populated for filtering even with no explicit
     * override set at shell creation. */
    emailType?: EmailType;
    blogType?: BlogType;
  },
): Promise<void> {
  const db = getAdminClient();
  const { content, meta, seoData, emailType, blogType } = args;

  const { data: existing, error: fetchErr } = await db
    .from("drafts")
    .select("job_id, meta")
    .eq("id", draftId)
    .single();
  if (fetchErr) throw fetchErr;

  const priorMeta = (existing.meta ?? {}) as DraftMeta;
  const mergedMeta: DraftMeta = {
    ...priorMeta,
    ...meta,
    generation: {
      started_at: priorMeta.generation?.started_at ?? new Date().toISOString(),
      ...priorMeta.generation,
      status: "ready",
      phase: "ready",
      label: "Ready",
    },
  };

  const { error: updateErr } = await db
    .from("drafts")
    .update({ content, meta: mergedMeta, seo_data: seoData ?? {} })
    .eq("id", draftId);
  if (updateErr) throw updateErr;

  const { error: jobErr } = await db
    .from("content_jobs")
    .update({
      status: "in_review",
      ...(emailType ? { email_type: emailType } : {}),
      ...(blogType ? { blog_type: blogType } : {}),
    })
    .eq("id", existing.job_id as string);
  if (jobErr) throw jobErr;
}

/** Lightweight phase-only update to meta.generation, for streaming progress. */
export async function patchDraftGeneration(
  draftId: string,
  patch: Partial<DraftGenerationState>,
): Promise<void> {
  const db = getAdminClient();

  const { data: existing, error: fetchErr } = await db
    .from("drafts")
    .select("meta")
    .eq("id", draftId)
    .single();
  if (fetchErr) throw fetchErr;

  const priorMeta = (existing.meta ?? {}) as DraftMeta;
  const generation: DraftGenerationState = {
    status: "generating",
    phase: "queued",
    label: "Starting",
    started_at: new Date().toISOString(),
    ...priorMeta.generation,
    ...patch,
  };

  const { error } = await db
    .from("drafts")
    .update({ meta: { ...priorMeta, generation } })
    .eq("id", draftId);
  if (error) throw error;

  // Whoever calls patchDraftGeneration is, by construction, the instance that
  // holds the generation_runs lock for this draft (see acquireGenerationLock).
  // Bump its heartbeat so a long-running phase doesn't look stale to another
  // instance's steal check. Best-effort: a missing table (migration 009 not
  // yet applied) or a since-released row must never fail generation itself.
  const { error: heartbeatErr } = await db
    .from("generation_runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("draft_id", draftId);
  if (heartbeatErr && !isMissingTableError(heartbeatErr)) {
    logError("db:generation-runs:heartbeat", heartbeatErr);
  }
}

/** A heartbeat older than this means the owning instance died mid-run
 * (crash, redeploy) without releasing its lock row, so it's safe to steal.
 * Kept comfortably above the 300s maxDuration on the generate-stream route:
 * a healthy run can't go this long between heartbeat bumps. */
const STALE_LOCK_MS = 6 * 60 * 1000;

/**
 * Cross-instance lock backing lib/pipeline/generation-runs.ts: true means
 * THIS call is now the sole owner of generation for `draftId` (either no
 * other instance was running it, or the prior owner's heartbeat went stale).
 * false means another instance actively holds it and the caller should poll
 * drafts.meta.generation instead of starting its own Claude call.
 *
 * Degrades to "always acquired" if migration 009 hasn't been applied yet, so
 * shipping this code never breaks generation against a stale schema.
 */
export async function acquireGenerationLock(draftId: string): Promise<boolean> {
  const db = getAdminClient();

  const { error: insertErr } = await db
    .from("generation_runs")
    .insert({ draft_id: draftId });
  if (!insertErr) return true;
  if (isMissingTableError(insertErr)) return true;
  if (insertErr.code !== "23505") throw insertErr; // not a "someone else has it" conflict

  const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const { data: stolen, error: stealErr } = await db
    .from("generation_runs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    })
    .eq("draft_id", draftId)
    .lt("heartbeat_at", staleBefore)
    .select("draft_id");
  if (stealErr) throw stealErr;
  return Boolean(stolen && stolen.length > 0);
}

/** Releases this instance's generation lock once a run finishes (success or
 * error), so a retry can acquire cleanly. Best-effort: cleanup failing must
 * never surface as a generation error to the reviewer. */
export async function releaseGenerationLock(draftId: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("generation_runs").delete().eq("draft_id", draftId);
  if (error && !isMissingTableError(error)) {
    logError("db:generation-runs:release-lock", error);
  }
}

/** Cheap meta-only read for the cross-instance polling fallback: an instance
 * that lost the generation lock race reads this instead of running its own
 * Claude call, so its SSE listeners still see real phase progress. */
export async function getDraftGenerationState(
  draftId: string,
): Promise<DraftGenerationState | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("drafts")
    .select("meta")
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw error;
  const meta = (data?.meta as DraftMeta | undefined) ?? {};
  return meta.generation ?? null;
}

/** Loads the minimal context the regeneration pipeline needs for a draft. */
export async function getDraftWithJobContext(
  draftId: string,
  brandId?: string,
): Promise<DraftJobContext | null> {
  const db = getAdminClient();

  // Falls back to a campaign-less select before migration 002 adds the column.
  // Pass brandId at any entry point that resolves a draft id from an
  // untrusted caller (an API route acting on a session user's request): it
  // scopes the lookup to content_jobs.brand_id so one brand's session can
  // never read or act on another brand's draft, and a mismatch returns null,
  // same as a nonexistent id, so callers can't distinguish "not yours" from
  // "doesn't exist." (See lib/draft-access.ts, the shared route-layer guard.)
  // Internal pipeline code that receives a draftId already authorized by its
  // caller's route omits brandId and gets the unscoped lookup.
  let primary = db
    .from("drafts")
    .select(
      `id, job_id, version, content, meta, state, content_jobs!inner(topic_id, campaign_id, type, email_type, blog_type, brand_id)`,
    )
    .eq("id", draftId);
  if (brandId) primary = primary.eq("content_jobs.brand_id", brandId);
  let { data, error } = await primary.maybeSingle();
  if (error) {
    let fallback = db
      .from("drafts")
      .select(
        `id, job_id, version, content, meta, state, content_jobs!inner(topic_id, type, email_type, blog_type, brand_id)`,
      )
      .eq("id", draftId);
    if (brandId) fallback = fallback.eq("content_jobs.brand_id", brandId);
    ({ data, error } = await fallback.maybeSingle());
  }
  if (error) throw error;
  if (!data) return null;

  const job = (
    data as {
      content_jobs?: {
        topic_id?: string;
        campaign_id?: string | null;
        type?: string;
        email_type?: string | null;
        blog_type?: string | null;
      } | null;
    }
  ).content_jobs;

  return {
    draftId: data.id as string,
    jobId: data.job_id as string,
    topicId: job?.topic_id ?? "",
    campaignId: job?.campaign_id ?? null,
    version: data.version as number,
    content: data.content as EmailDraftContent,
    meta: (data.meta as DraftMeta) ?? {},
    jobType: (job?.type as ContentJobType) ?? "email",
    state: (data.state as string) ?? "in_review",
    emailType: (job?.email_type as EmailType | null) ?? null,
    blogType: (job?.blog_type as BlogType | null) ?? null,
  };
}

// ── Publications (idempotent publishing, backed by unique(job_id, target)) ──

/** The publication row for a job + target, or null if it never published. */
export async function getPublication(
  jobId: string,
  target: string,
): Promise<PublicationRecord | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("publications")
    .select("*")
    .eq("job_id", jobId)
    .eq("target", target)
    .maybeSingle();
  if (error) throw error;
  return (data as PublicationRecord) ?? null;
}

/** True if the job has been published to ANY target (draft deletion gate). */
export async function isJobPublished(jobId: string): Promise<boolean> {
  const db = getAdminClient();
  const { count, error } = await db
    .from("publications")
    .select("*", { count: "exact", head: true })
    .eq("job_id", jobId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** The most recent publication for the job a draft belongs to (review screen). */
export async function getPublicationForDraft(
  draftId: string,
): Promise<PublicationRecord | null> {
  const db = getAdminClient();
  const { data: draft, error: draftErr } = await db
    .from("drafts")
    .select("job_id")
    .eq("id", draftId)
    .maybeSingle();
  if (draftErr) throw draftErr;
  if (!draft) return null;

  const { data, error } = await db
    .from("publications")
    .select("*")
    .eq("job_id", draft.job_id as string)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as PublicationRecord) ?? null;
}

/**
 * Records a publication. If a raced retry already inserted the row, the
 * unique(job_id, target) violation is swallowed and the existing row returned:
 * a retry must never double-post OR crash after the external write succeeded.
 */
export async function recordPublication(args: {
  jobId: string;
  target: string;
  externalId: string;
  url?: string;
  status?: string;
  scheduledFor?: string;
}): Promise<PublicationRecord> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("publications")
    .insert({
      job_id: args.jobId,
      target: args.target,
      external_id: args.externalId,
      url: args.url ?? null,
      status: args.status ?? "sent",
      scheduled_for: args.scheduledFor ?? null,
    })
    .select("*")
    .single();
  if (!error) return data as PublicationRecord;

  // 23505 = unique_violation: someone else won the race; read theirs back.
  if ((error as { code?: string }).code === "23505") {
    const existing = await getPublication(args.jobId, args.target);
    if (existing) return existing;
  }
  throw error;
}

/** Flips a job to published and stamps the topic's published_url when given. */
export async function markJobPublished(
  jobId: string,
  publishedUrl?: string,
): Promise<void> {
  const db = getAdminClient();
  const { data: job, error: jobErr } = await db
    .from("content_jobs")
    .update({ status: "published" })
    .eq("id", jobId)
    .select("topic_id")
    .single();
  if (jobErr) throw jobErr;

  if (job?.topic_id) {
    const { error } = await db
      .from("topics")
      .update({
        status: "published",
        ...(publishedUrl ? { published_url: publishedUrl } : {}),
      })
      .eq("id", job.topic_id as string);
    if (error) throw error;
  }
}

/**
 * Appends performance snapshot rows for one publication (Plan 2 analytics
 * loop). No upsert: performance is a time series, one row per metric per
 * fetch, and getLatestPerformance reads the newest row per metric.
 */
export async function recordPerformance(
  publicationId: string,
  metrics: PerformanceMetric[],
): Promise<void> {
  if (!metrics.length) return;
  const db = getAdminClient();
  const { error } = await db.from("performance").insert(
    metrics.map((m) => ({
      publication_id: publicationId,
      metric: m.metric,
      value: m.value,
    })),
  );
  if (error) throw error;
}

/** The newest value per metric for one publication (MAX(fetched_at) per metric). */
export async function getLatestPerformance(
  publicationId: string,
): Promise<(PerformanceMetric & { fetched_at: string })[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("performance")
    .select("metric, value, fetched_at")
    .eq("publication_id", publicationId)
    .order("fetched_at", { ascending: false });
  if (error) throw error;

  const latest = new Map<string, PerformanceMetric & { fetched_at: string }>();
  for (const row of (data ?? []) as { metric: string; value: number; fetched_at: string }[]) {
    if (!latest.has(row.metric)) latest.set(row.metric, row);
  }
  return Array.from(latest.values());
}

// ── Brand integrations (per-brand publishing connections; env stays fallback) ──

/** All configured connections for a brand. Empty before the user connects any. */
export async function getBrandIntegrations(
  brandId: string,
): Promise<BrandIntegration[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brand_integrations")
    .select("*")
    .eq("brand_id", brandId);
  if (error) {
    // Migration 004 (this table) may not be applied on live Supabase yet;
    // degrade to "no connections" instead of breaking the settings page.
    // The Connections UI lights up once the migration is run.
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
  return (data ?? []) as BrandIntegration[];
}

/** One connection by provider, or null if the brand hasn't connected it. */
export async function getBrandIntegration(
  brandId: string,
  providerId: string,
): Promise<BrandIntegration | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brand_integrations")
    .select("*")
    .eq("brand_id", brandId)
    .eq("provider_id", providerId)
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
  return (data as BrandIntegration) ?? null;
}

/**
 * Creates or replaces a connection row. The caller merges `config` first
 * (plain fields overwrite; secret fields only overwrite when a new value is
 * submitted, else the existing ciphertext is preserved), then hands the full
 * merged object here. unique(brand_id, provider_id) backs the upsert.
 */
export async function upsertBrandIntegration(
  brandId: string,
  providerId: string,
  config: Record<string, unknown>,
): Promise<BrandIntegration> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brand_integrations")
    .upsert(
      { brand_id: brandId, provider_id: providerId, config },
      { onConflict: "brand_id,provider_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as BrandIntegration;
}

/** Removes a connection so the provider falls back to env vars (or "none"). */
export async function deleteBrandIntegration(
  brandId: string,
  providerId: string,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("brand_integrations")
    .delete()
    .eq("brand_id", brandId)
    .eq("provider_id", providerId);
  if (error) throw error;
}

/** Returns the highest draft version number for a content job. */
export async function getLatestDraftVersion(jobId: string): Promise<number> {
  const db = getAdminClient();

  const { data, error } = await db
    .from("drafts")
    .select("version")
    .eq("job_id", jobId)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data.version as number;
}

/**
 * Marks a draft as rejected and records the reviewer's feedback.
 * Returns the job_id so the caller can queue a regeneration.
 */
export async function rejectDraftRecord(
  draftId: string,
  feedback: string,
): Promise<string> {
  const db = getAdminClient();

  const { data: draft, error: fetchErr } = await db
    .from("drafts")
    .select("job_id")
    .eq("id", draftId)
    .single();
  if (fetchErr) throw fetchErr;

  const { error: updateErr } = await db
    .from("drafts")
    .update({ state: "rejected" })
    .eq("id", draftId);
  if (updateErr) throw updateErr;

  const { error: approvalErr } = await db
    .from("approvals")
    .insert({ draft_id: draftId, decision: "rejected", feedback });
  if (approvalErr) throw approvalErr;

  return draft.job_id as string;
}

/**
 * Updates a draft's content IN PLACE: no new version, no state change. For
 * lightweight style adjustments (see lib/pipeline/adjust-style.ts), which are
 * cheap enough not to count against MAX_DRAFT_VERSIONS the way a full
 * reject-and-regenerate does.
 */
export async function updateDraftContent(
  draftId: string,
  content: EmailDraftContent,
  meta?: DraftMeta,
): Promise<void> {
  const db = getAdminClient();
  const patch = meta !== undefined ? { content, meta } : { content };
  const { error } = await db.from("drafts").update(patch).eq("id", draftId);
  if (error) throw error;
}

/**
 * Approves a draft. If editedContent is supplied the draft's content is updated
 * first and the decision is recorded as "edited"; otherwise it's "approved".
 */
export async function approveDraft(
  draftId: string,
  editedContent?: EmailDraftContent,
  editedMeta?: DraftMeta,
): Promise<void> {
  const db = getAdminClient();
  const decision = editedContent ? "edited" : "approved";

  const update: Record<string, unknown> = { state: "approved" };
  if (editedContent) update.content = editedContent;
  if (editedMeta) {
    // Merge over the CURRENT stored meta rather than flat-replacing it. The
    // review client builds its approve payload from meta captured at page
    // mount, so a flat replace would clobber anything the in-place edit
    // pipelines wrote after load: email_copy synced after a copy edit, and
    // new style_edit_history entries. The server stays
    // authoritative for those; the client only meaningfully owns the two meta
    // text fields and the CTA url, so we layer just those onto the stored row.
    const { data: row, error: readErr } = await db
      .from("drafts")
      .select("meta")
      .eq("id", draftId)
      .single();
    if (readErr) throw readErr;
    const currentMeta = (row?.meta ?? {}) as DraftMeta;
    update.meta = {
      ...currentMeta,
      meta_title: editedMeta.meta_title ?? currentMeta.meta_title,
      meta_description:
        editedMeta.meta_description ?? currentMeta.meta_description,
      email_copy: {
        ...currentMeta.email_copy,
        cta_url: editedMeta.email_copy?.cta_url ?? currentMeta.email_copy?.cta_url,
      },
    };
  }

  const { error: updateErr } = await db
    .from("drafts")
    .update(update)
    .eq("id", draftId);
  if (updateErr) throw updateErr;

  const { error: approvalErr } = await db
    .from("approvals")
    .insert({ draft_id: draftId, decision });
  if (approvalErr) throw approvalErr;
}

/** Saves a newly generated version of a draft for the same content job. */
export async function persistRegeneratedDraft(args: {
  jobId: string;
  version: number;
  content: EmailDraftContent;
  meta?: DraftMeta;
  seoData?: DraftSeoData;
  /** Backfills content_jobs.email_type/blog_type in step with the
   * regenerated draft, same reasoning as populateDraft's version. */
  emailType?: EmailType;
  blogType?: BlogType;
}): Promise<string> {
  const db = getAdminClient();
  const { jobId, version, content, meta, seoData, emailType, blogType } = args;

  const { data, error } = await db
    .from("drafts")
    .insert({
      job_id: jobId,
      version,
      content,
      meta: meta ?? {},
      seo_data: seoData ?? {},
      state: "in_review",
    })
    .select("id")
    .single();
  if (error) throw error;

  if (emailType || blogType) {
    const { error: jobErr } = await db
      .from("content_jobs")
      .update({
        ...(emailType ? { email_type: emailType } : {}),
        ...(blogType ? { blog_type: blogType } : {}),
      })
      .eq("id", jobId);
    if (jobErr) throw jobErr;
  }

  return data.id as string;
}

/** Loads a draft with its topic title for the review screen. */
export async function getDraftForReview(
  draftId: string,
  brandId: string,
): Promise<DraftForReview | null> {
  const db = getAdminClient();

  // Falls back to progressively slimmer selects before migrations 003
  // (archived), 020 (feedback), and 023 (feedback_note) add their columns, so
  // this doesn't hard-break every draft page in the meantime. Always scoped
  // to content_jobs.brand_id (see getDraftWithJobContext for why).
  let { data, error } = await db
    .from("drafts")
    .select(
      `id, version, state, content, meta, seo_data, archived, feedback, feedback_note, created_at,
       content_jobs!inner ( type, brand_id, topics ( title ) )`,
    )
    .eq("id", draftId)
    .eq("content_jobs.brand_id", brandId)
    .maybeSingle();
  if (error) {
    ({ data, error } = await db
      .from("drafts")
      .select(
        `id, version, state, content, meta, seo_data, archived, feedback, created_at,
         content_jobs!inner ( type, brand_id, topics ( title ) )`,
      )
      .eq("id", draftId)
      .eq("content_jobs.brand_id", brandId)
      .maybeSingle());
  }
  if (error) {
    ({ data, error } = await db
      .from("drafts")
      .select(
        `id, version, state, content, meta, seo_data, created_at,
         content_jobs!inner ( type, brand_id, topics ( title ) )`,
      )
      .eq("id", draftId)
      .eq("content_jobs.brand_id", brandId)
      .maybeSingle());
  }
  if (error) throw error;
  if (!data) return null;

  // Supabase types the embedded relations loosely; narrow defensively.
  const job = (
    data as {
      content_jobs?: { type?: string; topics?: { title?: string } | null };
    }
  ).content_jobs;
  const topicTitle = job?.topics?.title ?? null;

  return {
    id: data.id,
    version: data.version,
    state: data.state,
    content: data.content as EmailDraftContent,
    meta: (data.meta ?? {}) as DraftMeta,
    seo_data: (data.seo_data ?? {}) as DraftSeoData,
    topic_title: topicTitle,
    archived: (data.archived as boolean) ?? false,
    created_at: data.created_at,
    job_type: (job?.type as ContentJobType) ?? "email",
    feedback: ((data as { feedback?: string }).feedback as DraftFeedback) ?? null,
    feedback_note: (data as { feedback_note?: string | null }).feedback_note ?? null,
  };
}

/** Sets (or clears, with null) the reviewer's thumbs rating on a draft, and
 * optionally a reason alongside it. Clearing the rating (feedback null)
 * always clears the note too, whatever the caller passes for it. */
export async function setDraftFeedback(
  draftId: string,
  feedback: DraftFeedback | null,
  note?: string | null,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("drafts")
    .update({ feedback, feedback_note: feedback ? (note ?? null) : null })
    .eq("id", draftId);
  if (error) throw error;
}

/**
 * The most recent thumbs-rated EMAIL drafts for a brand, distilled into short
 * copy excerpts the generation prompt can hold up as "write like this" /
 * "never like this" examples. Capped per side so the block stays lean, and
 * non-fatal by design: rating history improving future drafts must never be
 * the reason a draft fails to generate.
 */
export async function listFeedbackEmailExamples(
  brandId: string,
  perSide = 3,
): Promise<FeedbackEmailExample[]> {
  const db = getAdminClient();
  let { data, error } = await db
    .from("drafts")
    .select(
      `content, meta, feedback, feedback_note, created_at,
       content_jobs!inner ( brand_id, type, email_type )`,
    )
    .eq("content_jobs.brand_id", brandId)
    .eq("content_jobs.type", "email")
    .not("feedback", "is", null)
    .order("created_at", { ascending: false })
    .limit(24);
  // Migration 023 (feedback_note) may not be applied yet; fall back to the
  // pre-023 select rather than losing the whole feedback loop over one column.
  // Cast to the first query's shape: the row mapping below already treats
  // feedback_note as optional, so a missing column here is harmless.
  if (error) {
    const fallback = await db
      .from("drafts")
      .select(
        `content, meta, feedback, created_at,
         content_jobs!inner ( brand_id, type, email_type )`,
      )
      .eq("content_jobs.brand_id", brandId)
      .eq("content_jobs.type", "email")
      .not("feedback", "is", null)
      .order("created_at", { ascending: false })
      .limit(24);
    data = fallback.data as typeof data;
    error = fallback.error;
  }
  if (error) {
    logWarn("db:listFeedbackEmailExamples", error.message, { brandId });
    return [];
  }

  const examples: FeedbackEmailExample[] = [];
  const counts = { up: 0, down: 0 };
  for (const row of (data ?? []) as {
    content: EmailDraftContent | null;
    meta: DraftMeta | null;
    feedback: string | null;
    feedback_note?: string | null;
    content_jobs?: { email_type?: string | null };
  }[]) {
    const feedback = row.feedback === "up" || row.feedback === "down" ? row.feedback : null;
    if (!feedback || counts[feedback] >= perSide) continue;
    const copy = row.meta?.email_copy;
    const subject = copy?.subject ?? row.content?.subject ?? "";
    const body = (copy?.body_sections ?? [])
      .map((s) => s.body)
      .join("\n")
      .trim();
    if (!subject && !body) continue;
    counts[feedback] += 1;
    examples.push({
      feedback,
      subject,
      email_type: (row.content_jobs?.email_type as EmailType) ?? null,
      excerpt: body.slice(0, 600),
      note: row.feedback_note ?? null,
    });
  }
  return examples;
}

// ── Brand resolution (multi-tenant: a brand belongs to its members) ──────────

/**
 * The brand the given user owns/is a member of, or null if they have none (the
 * UI then sends them to onboarding). Resolves through brand_members (migration
 * 017) instead of "the first brand", so each customer's data is isolated at the
 * query layer. The service-role client stays for now; RLS is the later
 * defense-in-depth step (multi-tenancy-roadmap.md Step 3).
 */
export async function getBrandForUser(userId: string): Promise<Brand | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brands")
    .select("*, brand_members!inner(user_id)")
    .eq("brand_members.user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Brand) ?? null;
}

/** A brand by id, for pipeline/cron paths that already hold a brand id. */
export async function getBrandById(brandId: string): Promise<Brand | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .maybeSingle();
  if (error) throw error;
  return (data as Brand) ?? null;
}

/** The brand a draft belongs to (draft -> job -> brand). Used by publish and
 *  performance, which act on a specific draft rather than the session user. */
export async function getBrandByDraftId(draftId: string): Promise<Brand | null> {
  const db = getAdminClient();
  const { data: draft, error: draftErr } = await db
    .from("drafts")
    .select("job_id")
    .eq("id", draftId)
    .maybeSingle();
  if (draftErr) throw draftErr;
  if (!draft?.job_id) return null;
  const { data: job, error: jobErr } = await db
    .from("content_jobs")
    .select("brand_id")
    .eq("id", draft.job_id)
    .maybeSingle();
  if (jobErr) throw jobErr;
  if (!job?.brand_id) return null;
  return getBrandById(job.brand_id);
}

// ── Settings queries ──────────────────────────────────────────────────────────

/** Returns the given user's brand row, or null if they have none yet. */
export async function getSingleBrand(userId: string): Promise<Brand | null> {
  return getBrandForUser(userId);
}

/**
 * Creates a minimal brand row (name only) and links the creating user as its
 * owner (brand_members, migration 017). The first step of onboarding when a
 * user has no brand; subsequent onboarding steps fill in the profile via the
 * per-section update functions. Returns the new brand. Starter credits are
 * granted separately by the billing layer once the ledger exists.
 */
export async function createBrand(name: string, userId: string): Promise<Brand> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brands")
    .insert({ name: name.trim() })
    .select("*")
    .single();
  if (error) throw error;
  const brand = data as Brand;
  // The membership row is what makes the brand reachable: without it, every
  // read (which resolves through brand_members) returns nothing and the user is
  // stuck on onboarding with an orphaned brand. Clean up and fail loudly rather
  // than leaving that behind.
  const { error: memberErr } = await db
    .from("brand_members")
    .insert({ brand_id: brand.id, user_id: userId, role: "owner" });
  if (memberErr) {
    await db.from("brands").delete().eq("id", brand.id);
    throw memberErr;
  }
  return brand;
}

/** Loads the given user's brand, strategy, and all ICPs for the settings page. */
export async function getBrandWithIcps(userId: string): Promise<{
  brand: Brand;
  strategy: Strategy | null;
  icps: Icp[];
} | null> {
  const brand = await getBrandForUser(userId);
  if (!brand) return null;

  const db = getAdminClient();

  const { data: strategy, error: stratErr } = await db
    .from("strategies")
    .select("*")
    .eq("brand_id", brand.id)
    .maybeSingle();
  if (stratErr) throw stratErr;
  if (!strategy) return { brand: brand as Brand, strategy: null, icps: [] };

  const { data: icps, error: icpErr } = await db
    .from("icps")
    .select("*")
    .eq("strategy_id", strategy.id)
    .order("is_primary", { ascending: false });
  if (icpErr) throw icpErr;

  return {
    brand: brand as Brand,
    strategy: strategy as Strategy,
    icps: (icps ?? []) as Icp[],
  };
}

/** Updates the brand's name, mailerlite_config, and seo_defaults. */
export async function updateBrandBasics(
  brandId: string,
  data: {
    name: string;
    mailerlite_config: MailerliteConfig;
    seo_defaults: SeoDefaults;
  },
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("brands")
    .update({
      name: data.name,
      mailerlite_config: data.mailerlite_config,
      seo_defaults: data.seo_defaults,
    })
    .eq("id", brandId);
  if (error) throw error;
}

/** Replaces the strategy's funnel_definition. */
export async function updateFunnelDefinition(
  strategyId: string,
  funnelDefinition: Record<string, { cta_type: string }>,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("strategies")
    .update({ funnel_definition: funnelDefinition })
    .eq("id", strategyId);
  if (error) throw error;
}

/** Creates a new spoke topic under a cluster with status "idea". */
export async function createTopic(
  clusterId: string,
  data: TopicFormData,
): Promise<Topic> {
  const db = getAdminClient();
  const { data: topic, error } = await db
    .from("topics")
    .insert({
      cluster_id: clusterId,
      title: data.title.trim(),
      target_keyword: data.target_keyword.trim() || null,
      intent: data.intent.trim() || null,
      funnel_stage: data.funnel_stage || null,
      maps_to_product: data.maps_to_product.trim() || null,
      status: "idea",
      internal_link_targets: [],
      distribution_recipe: [],
    })
    .select("*")
    .single();
  if (error) throw error;
  return topic as Topic;
}

/** Updates the 5 user-editable fields on a topic. */
export async function updateTopic(
  topicId: string,
  data: TopicFormData,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("topics")
    .update({
      title: data.title.trim(),
      target_keyword: data.target_keyword.trim() || null,
      intent: data.intent.trim() || null,
      funnel_stage: data.funnel_stage || null,
      maps_to_product: data.maps_to_product.trim() || null,
    })
    .eq("id", topicId);
  if (error) throw error;
}

/** Hard-deletes a topic. Caller must verify status === "idea" before calling. */
export async function deleteTopic(topicId: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("topics").delete().eq("id", topicId);
  if (error) throw error;
}

/**
 * Archives (or unarchives) a topic: hides it from the default Content Plan
 * view without touching its data. Safe for any status, unlike hard delete
 * (idea-only, see app/api/topics/[id]/route.ts) since content_jobs.topic_id
 * is ON DELETE SET NULL and would orphan real generation history.
 */
export async function archiveTopic(topicId: string, archived: boolean): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("topics").update({ archived }).eq("id", topicId);
  if (error) throw error;
}

/** Persists the result of a DataForSEO "Research" action on one topic. */
export async function updateTopicKeywordData(
  topicId: string,
  keywordData: KeywordData,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("topics")
    .update({ keyword_data: keywordData })
    .eq("id", topicId);
  if (error) throw error;
}

/** Replaces the brand's voice_profile with the supplied value. */
export async function updateBrandVoice(
  brandId: string,
  voiceProfile: VoiceProfile,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("brands")
    .update({ voice_profile: voiceProfile })
    .eq("id", brandId);
  if (error) throw error;
}

/** Replaces the brand's visual_identity (logo, colors, fonts, footer). */
export async function updateVisualIdentity(
  brandId: string,
  visualIdentity: VisualIdentity,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("brands")
    .update({ visual_identity: visualIdentity })
    .eq("id", brandId);
  if (error) throw error;
}

/** Replaces the brand's positioning (description, tagline, differentiators, competitors). */
export async function updatePositioning(
  brandId: string,
  positioning: Positioning,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("brands")
    .update({ positioning })
    .eq("id", brandId);
  if (error) throw error;
}

/** Writes the onboarding conversation state (transcript + completed flag). */
export async function updateOnboardingState(
  brandId: string,
  state: OnboardingState,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("brands")
    .update({ onboarding_state: state })
    .eq("id", brandId);
  if (error) throw error;
}

/**
 * Ensures the brand has a strategy (with a default funnel→CTA mapping) and a
 * primary ICP, creating stubs if missing. Needed because a freshly-created
 * brand has neither, the chat onboarding builds the ICP, and the funnel
 * defaults let generation work immediately. Returns both.
 */
export async function ensureStrategyAndPrimaryIcp(
  brandId: string,
): Promise<{ strategy: Strategy; primaryIcp: Icp }> {
  const db = getAdminClient();

  const DEFAULT_FUNNEL = {
    awareness: { cta_type: "newsletter_signup" },
    consideration: { cta_type: "newsletter_signup" },
    decision: { cta_type: "book_call" },
  };
  const DEFAULT_CTA_LIBRARY: Record<string, string> = {
    newsletter_signup: "Subscribe to the newsletter for more.",
    book_call: "Book a call to see if we're a fit.",
    portfolio: "See our work.",
  };

  let strategy: Strategy | null = null;
  const { data: existing, error: stratErr } = await db
    .from("strategies")
    .select("*")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (stratErr) throw stratErr;
  if (existing) {
    strategy = existing as Strategy;
  } else {
    const { data: created, error: createErr } = await db
      .from("strategies")
      .insert({ brand_id: brandId, funnel_definition: DEFAULT_FUNNEL })
      .select("*")
      .single();
    if (createErr) throw createErr;
    strategy = created as Strategy;

    // Backfill a default CTA library on the brand if none exists, so the
    // funnel→CTA resolution in generation has text to use.
    const { data: brand } = await db
      .from("brands")
      .select("voice_profile")
      .eq("id", brandId)
      .single();
    const vp = (brand?.voice_profile ?? {}) as VoiceProfile;
    if (!vp.cta_library || Object.keys(vp.cta_library).length === 0) {
      await db
        .from("brands")
        .update({
          voice_profile: { ...vp, cta_library: DEFAULT_CTA_LIBRARY },
        })
        .eq("id", brandId);
    }
  }

  const { data: icps, error: icpErr } = await db
    .from("icps")
    .select("*")
    .eq("strategy_id", strategy.id)
    .order("is_primary", { ascending: false });
  if (icpErr) throw icpErr;

  let primaryIcp = (icps?.[0] as Icp) ?? null;
  if (!primaryIcp) {
    const { data: created, error: createErr } = await db
      .from("icps")
      .insert({
        strategy_id: strategy.id,
        label: "Primary ICP",
        is_primary: true,
        profile: {},
      })
      .select("*")
      .single();
    if (createErr) throw createErr;
    primaryIcp = created as Icp;
  }

  // A brand is only generation-ready when a cluster exists for topics to
  // attach to; guarantee it here so onboarding always leaves a working setup.
  await ensureDefaultCluster(strategy.id);

  return { strategy, primaryIcp };
}

/** The brand an ICP belongs to (icp -> strategy -> brand_id), or null if the
 * ICP doesn't exist. Used to confirm ownership before an edit. */
export async function getIcpBrandId(icpId: string): Promise<string | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("icps")
    .select("strategies!inner ( brand_id )")
    .eq("id", icpId)
    .maybeSingle();
  if (error) throw error;
  const strategy = (data as { strategies?: { brand_id?: string } | null } | null)?.strategies;
  return strategy?.brand_id ?? null;
}

/** Updates an ICP's label and profile. */
export async function updateIcp(
  icpId: string,
  data: { label: string; profile: IcpProfile },
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("icps")
    .update({ label: data.label, profile: data.profile })
    .eq("id", icpId);
  if (error) throw error;
}

/** Replaces the brand's guidelines. Caller stamps approved_at on explicit save. */
export async function updateBrandGuidelines(
  brandId: string,
  guidelines: BrandGuidelines,
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("brands")
    .update({ guidelines })
    .eq("id", brandId);
  if (error) throw error;
}

// ── Products (the offers behind topics.maps_to_product) ───────────────────────

/**
 * All products for a brand, alphabetical by name. Returns [] (with a warning)
 * when the products table doesn't exist yet so Settings keeps working
 * pre-migration.
 */
export async function listProducts(brandId: string): Promise<Product[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("products")
    .select("*")
    .eq("brand_id", brandId)
    .order("name", { ascending: true });
  if (error && isMissingTableError(error)) {
    logWarn(
      "db:queries:list-products",
      "products table missing, apply db/migrations/002 to enable products",
    );
    return [];
  }
  if (error) throw error;
  return (data ?? []) as Product[];
}

/** Creates or updates a product by (brand_id, slug). */
export async function upsertProduct(
  brandId: string,
  product: {
    slug: string;
    name: string;
    description: string | null;
    deliverables: string[];
    price_point: string | null;
    url: string | null;
    image_url?: string | null;
  },
): Promise<Product> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("products")
    .upsert(
      { brand_id: brandId, ...product },
      { onConflict: "brand_id,slug" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as Product;
}

/** Hard-deletes a product. Topics keep their slug; the prompt just loses detail. */
export async function deleteProduct(productId: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("products").delete().eq("id", productId);
  if (error) throw error;
}

// ── Brand memory (durable facts the create agent learns and recalls) ─────────

/** All learned facts for a brand, newest first. Degrades to [] pre-migration-007. */
export async function listBrandMemory(brandId: string): Promise<BrandMemory[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brand_memory")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error && isMissingTableError(error)) {
    logWarn(
      "db:queries:list-brand-memory",
      "brand_memory table missing, apply db/migrations/007 to enable memory",
    );
    return [];
  }
  if (error) throw error;
  return (data ?? []) as BrandMemory[];
}

/** Saves a durable fact the agent learned (its `remember` tool). */
export async function addBrandMemory(
  brandId: string,
  fact: { content: string; kind?: string; source?: string },
): Promise<BrandMemory> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brand_memory")
    .insert({ brand_id: brandId, ...fact })
    .select("*")
    .single();
  if (error) throw error;
  return data as BrandMemory;
}

/** Deletes a learned fact (its `forget` tool). */
export async function deleteBrandMemory(id: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("brand_memory").delete().eq("id", id);
  if (error) throw error;
}

/**
 * First cluster under the brand's strategy, the home for topics created from
 * the campaign chat (which has no cluster concept). Null when no clusters exist.
 */
export async function getDefaultClusterId(
  strategyId: string,
): Promise<string | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("clusters")
    .select("id, pillars!inner(strategy_id)")
    .eq("pillars.strategy_id", strategyId)
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.id as string | undefined) ?? null;
}

/**
 * Guarantees a cluster exists to attach topics to, creating a starter
 * pillar + cluster when the strategy has none (a fresh, unseeded brand).
 * Without this, every topic-creation path dead-ends for new users.
 */
export async function ensureDefaultCluster(strategyId: string): Promise<string> {
  const existing = await getDefaultClusterId(strategyId);
  if (existing) return existing;

  const db = getAdminClient();
  const { data: pillar, error: pillarErr } = await db
    .from("pillars")
    .insert({
      strategy_id: strategyId,
      name: "Core content",
      description:
        "Starter pillar created automatically. Rename or reorganize it as the content plan grows.",
      primary_funnel_stage: "awareness",
    })
    .select("id")
    .single();
  if (pillarErr) throw pillarErr;

  const { data: cluster, error: clusterErr } = await db
    .from("clusters")
    .insert({ pillar_id: pillar.id, hub_title: "Starter ideas" })
    .select("id")
    .single();
  if (clusterErr) throw clusterErr;
  return cluster.id as string;
}

// ── Campaigns (the strategic interview that briefs generation) ────────────────

/** Creates an empty campaign in `briefing` for the brand. */
export async function createCampaign(brandId: string): Promise<Campaign> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("campaigns")
    .insert({ brand_id: brandId })
    .select("*")
    .single();
  if (error) throw error;
  return data as Campaign;
}

export async function getCampaign(
  campaignId: string,
): Promise<Campaign | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  return (data as Campaign) ?? null;
}

/**
 * The brand's most recently active campaign (anything not yet `done`), so the
 * dashboard can resume the create-agent thread on reload instead of starting
 * blank. Null when there's nothing in flight.
 */
export async function getLatestActiveCampaign(
  brandId: string,
): Promise<Campaign | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .eq("brand_id", brandId)
    .neq("status", "done")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Campaign) ?? null;
}

/** Every campaign for the brand, newest-updated first, for the Campaigns list page. */
export async function listCampaigns(brandId: string): Promise<Campaign[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .eq("brand_id", brandId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as Campaign[]) ?? [];
}

/**
 * Per-campaign email/sent/scheduled counts for the Campaigns list page, keyed
 * by campaign id. Two round-trips (jobs, then their publications) instead of
 * a nested select: content_jobs has several relationships (topic, campaign),
 * so an inferred join risks an ambiguous-relationship error, and this is the
 * same stitching style listDrafts already uses for source-email subjects.
 */
export async function getCampaignPublishProgress(
  campaignIds: string[],
): Promise<Map<string, CampaignPublishProgress>> {
  const progress = new Map<string, CampaignPublishProgress>();
  if (campaignIds.length === 0) return progress;

  const db = getAdminClient();
  const { data: jobs, error: jobsErr } = await db
    .from("content_jobs")
    .select("id, campaign_id, type")
    .in("campaign_id", campaignIds)
    .eq("type", "email");
  if (jobsErr) throw jobsErr;

  const emailJobs = (jobs ?? []) as { id: string; campaign_id: string }[];
  for (const job of emailJobs) {
    const entry = progress.get(job.campaign_id) ?? { emails: 0, sent: 0, scheduled: 0 };
    entry.emails += 1;
    progress.set(job.campaign_id, entry);
  }

  const jobIds = emailJobs.map((j) => j.id);
  if (jobIds.length === 0) return progress;

  const { data: pubs, error: pubsErr } = await db
    .from("publications")
    .select("job_id, status")
    .in("job_id", jobIds);
  if (pubsErr) throw pubsErr;

  const campaignByJobId = new Map(emailJobs.map((j) => [j.id, j.campaign_id]));
  for (const pub of (pubs ?? []) as { job_id: string; status: string }[]) {
    const campaignId = campaignByJobId.get(pub.job_id);
    const entry = campaignId ? progress.get(campaignId) : undefined;
    if (!entry) continue;
    if (pub.status === "sent") entry.sent += 1;
    else if (pub.status === "scheduled") entry.scheduled += 1;
  }

  return progress;
}

/**
 * Hard-deletes a campaign row. content_jobs.campaign_id is `on delete set
 * null`, so the campaign's emails/blogs (and anything already published)
 * survive untouched, just detached from this campaign; call sites should
 * still block the delete when the campaign has sent/scheduled emails so that
 * history isn't orphaned from a campaign the user can no longer find.
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("campaigns").delete().eq("id", campaignId);
  if (error) throw error;
}

/**
 * Archives (or unarchives) a campaign: hides it from the default Campaigns
 * list without touching its emails or publish history. Unlike hard delete,
 * always safe regardless of sent/scheduled state.
 */
export async function archiveCampaign(campaignId: string, archived: boolean): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("campaigns").update({ archived }).eq("id", campaignId);
  if (error) throw error;
}

/** Patches a campaign (brief, topic, transcript, status) and bumps updated_at. */
export async function updateCampaign(
  campaignId: string,
  patch: {
    brief?: CampaignBrief;
    topic_id?: string | null;
    chat_state?: CampaignChatState;
    status?: CampaignStatus;
  },
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("campaigns")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (error) throw error;
}

// ── Flat list queries (dashboard Emails/Blogs tabs + assistant context) ───────

/**
 * A flat list of drafts, newest first, with its topic title. Pass `jobType` to
 * scope to one kind (the Emails and Blogs tabs each pass theirs); leave it off
 * for everything (the Home tab and the assistant context do this). Blog rows
 * spun off an email also carry the source email's id + subject so the Blogs
 * list can show "From {email}" without an N+1 per row.
 */
export async function listDrafts(
  brandId: string,
  options?: { jobType?: ContentJobType },
): Promise<DraftListRow[]> {
  const db = getAdminClient();
  const { jobType } = options ?? {};

  let data: Record<string, unknown>[] | null;
  let error: { message: string } | null;

  // Primary select (post-migration-003, includes archived). Scoped to one kind
  // when jobType is given (the Emails/Blogs tabs each pass theirs), and
  // always scoped to the caller's brand via content_jobs.brand_id so one
  // account never sees another brand's drafts.
  let primary = db
    .from("drafts")
    .select(
      `id, version, state, archived, created_at, content, meta,
     content_jobs!inner ( type, brand_id, topics ( title ) )`,
    )
    .eq("content_jobs.brand_id", brandId);
  if (jobType) primary = primary.eq("content_jobs.type", jobType);
  ({ data, error } = await primary
    .order("created_at", { ascending: false })
    .limit(100));

  if (error) {
    // Fallback: archived-less select for DBs predating migration 003.
    let fallback = db
      .from("drafts")
      .select(
        `id, version, state, created_at, content, meta,
       content_jobs!inner ( type, brand_id, topics ( title ) )`,
      )
      .eq("content_jobs.brand_id", brandId);
    if (jobType) fallback = fallback.eq("content_jobs.type", jobType);
    ({ data, error } = await fallback
      .order("created_at", { ascending: false })
      .limit(100));
  }
  if (error) throw error;

  const rows: DraftListRow[] = (data ?? []).map((d) => {
    const job = (
      d as {
        content_jobs?: { type?: string; topics?: { title?: string } | null };
      }
    ).content_jobs;
    const content = d.content as EmailDraftContent | null;
    const meta = (d.meta ?? {}) as DraftMeta;
    return {
      id: d.id as string,
      version: d.version as number,
      state: d.state as string,
      archived: (d.archived as boolean) ?? false,
      created_at: d.created_at as string,
      topic_title: job?.topics?.title ?? null,
      subject: content?.subject ?? "",
      job_type: (job?.type as ContentJobType) ?? "email",
      source_draft_id: meta.source_draft_id ?? null,
      source_subject: null,
    };
  });

  // Stitch the source email subject onto each blog row in one extra round-trip.
  const sourceIds = [
    ...new Set(
      rows.map((r) => r.source_draft_id).filter((x): x is string => !!x),
    ),
  ];
  if (sourceIds.length) {
    const { data: sources } = await db
      .from("drafts")
      .select("id, content")
      .in("id", sourceIds);
    const subjectById = new Map(
      (sources ?? []).map((s) => [
        s.id as string,
        (s.content as EmailDraftContent | null)?.subject ?? "",
      ]),
    );
    for (const r of rows) {
      if (r.source_draft_id) {
        r.source_subject = subjectById.get(r.source_draft_id) ?? null;
      }
    }
  }

  return rows;
}

/** Just the subject line of a draft, for cross-links (a blog's source email). */
export async function getDraftSubject(draftId: string): Promise<string | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("drafts")
    .select("content")
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw error;
  return (data?.content as EmailDraftContent | null)?.subject ?? null;
}

/**
 * Finds the blog draft spun off the given email draft (if any), via
 * meta.source_draft_id. Lets the email review screen turn "Create blog post"
 * into a link to the post that already exists instead of a duplicate.
 */
export async function getBlogDraftFromEmail(
  emailDraftId: string,
  brandId: string,
): Promise<{ draftId: string; subject: string } | null> {
  return getSpinoffDraft(emailDraftId, "blog", brandId);
}

/** The flyer spun off the given email draft (if any), same idea as
 * getBlogDraftFromEmail: turns "Create flyer" into a link once one exists. */
export async function getFlyerDraftFromEmail(
  emailDraftId: string,
  brandId: string,
): Promise<{ draftId: string; subject: string } | null> {
  return getSpinoffDraft(emailDraftId, "social", brandId);
}

/** A draft of the given kind whose meta.source_draft_id points at the email.
 * Kind-scoped because blogs AND flyers both spin off emails now, and
 * brand-scoped so this can't be used to probe another brand's drafts. */
async function getSpinoffDraft(
  emailDraftId: string,
  jobType: ContentJobType,
  brandId: string,
): Promise<{ draftId: string; subject: string } | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("drafts")
    .select("id, content, content_jobs!inner ( type, brand_id )")
    .eq("meta->>source_draft_id", emailDraftId)
    .eq("content_jobs.type", jobType)
    .eq("content_jobs.brand_id", brandId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    draftId: data.id as string,
    subject: (data.content as EmailDraftContent | null)?.subject ?? "",
  };
}

/**
 * The structured email copy of a draft (meta.email_copy), for the flyer
 * pipeline to distill a source email's offer into flyer copy. Null when the
 * draft doesn't exist or predates structured copy.
 */
export async function getEmailCopyForDraft(
  draftId: string,
): Promise<EmailCopy | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("drafts")
    .select("meta")
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw error;
  return ((data?.meta ?? {}) as DraftMeta).email_copy ?? null;
}

// ── Style references (migration 014, extended by 016) ───────────────────────
// One table, two libraries: flyer style references (kind 'flyer', the original
// behavior) and email design references (kind 'email', whose layout email
// generation recreates).

/**
 * The brand's reference images of the given kind, newest first. kind defaults
 * to 'flyer' so the original flyer callers keep their exact behavior.
 *
 * Degrades twice over: no table (pre-014) and no kind column (pre-016) both
 * mean "nothing to filter on", so a partially-migrated DB falls back to the
 * unfiltered flyer library rather than crashing a generation.
 */
export async function listStyleReferences(
  brandId: string,
  kind: StyleReferenceKind = "flyer",
): Promise<StyleReference[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("style_references")
    .select("*")
    .eq("brand_id", brandId)
    .eq("kind", kind)
    .order("created_at", { ascending: false });
  if (!error) return (data ?? []) as StyleReference[];

  // Pre-migration-014 DBs have no table yet; the library is just empty.
  if (isMissingTableError(error)) return [];
  if (!isMissingColumnError(error)) throw error;

  // Pre-016: every row is a flyer reference by definition, so an email-kind
  // lookup finds nothing and a flyer lookup is the whole table.
  if (kind === "email") return [];
  const fallback = await db
    .from("style_references")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []) as StyleReference[];
}

export async function getStyleReference(
  id: string,
): Promise<StyleReference | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("style_references")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as StyleReference) ?? null;
}

/**
 * The kind/mode/design_profile columns are omitted from the insert unless the
 * caller passes them, so a plain flyer upload still works against a pre-016
 * database (where those columns don't exist yet).
 */
export async function createStyleReference(args: {
  brandId: string;
  name: string;
  imageUrl: string;
  storagePath: string;
  notes?: string;
  kind?: StyleReferenceKind;
  mode?: StyleReferenceMode;
  designProfile?: EmailDesignProfile | null;
}): Promise<StyleReference> {
  const db = getAdminClient();
  const row: Record<string, unknown> = {
    brand_id: args.brandId,
    name: args.name.trim(),
    image_url: args.imageUrl,
    storage_path: args.storagePath,
    notes: args.notes?.trim() || null,
  };
  if (args.kind) row.kind = args.kind;
  if (args.mode) row.mode = args.mode;
  if (args.designProfile !== undefined) row.design_profile = args.designProfile;

  const { data, error } = await db
    .from("style_references")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as StyleReference;
}

/** Deletes the row only; the caller removes the storage object first (it has
 * the storage_path from getStyleReference). */
export async function deleteStyleReference(id: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("style_references").delete().eq("id", id);
  if (error) throw error;
}

// ── Media library (migration 024) ───────────────────────────────────────────
// Every image the app hosts gets a row here so it can be browsed and reused
// later without a fresh generation. See MediaAsset in lib/db/types.ts.

export async function listMediaAssets(
  brandId: string,
  kind?: MediaAssetKind,
): Promise<MediaAsset[]> {
  const db = getAdminClient();
  let query = db
    .from("media_assets")
    .select("*")
    .eq("brand_id", brandId);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    // Pre-migration-024 DBs have no table yet; the library is just empty.
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as MediaAsset[];
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("media_assets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as MediaAsset) ?? null;
}

/**
 * Records one hosted image. Called as a non-fatal side effect everywhere an
 * image gets hosted (generation, upload, re-host) — callers should catch and
 * log rather than let a recording failure break the actual image operation.
 */
export async function createMediaAsset(args: {
  brandId: string;
  url: string;
  storagePath: string;
  alt?: string | null;
  kind: MediaAssetKind;
  source: MediaAssetSource;
  style?: string | null;
  prompt?: string | null;
  width?: number | null;
  height?: number | null;
  originDraftId?: string | null;
}): Promise<MediaAsset> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("media_assets")
    .insert({
      brand_id: args.brandId,
      url: args.url,
      storage_path: args.storagePath,
      alt: args.alt ?? null,
      kind: args.kind,
      source: args.source,
      style: args.style ?? null,
      prompt: args.prompt ?? null,
      width: args.width ?? null,
      height: args.height ?? null,
      origin_draft_id: args.originDraftId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as MediaAsset;
}

/** Deletes the row only; the caller removes the storage object first (it has
 * the storage_path from getMediaAsset). */
export async function deleteMediaAsset(id: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("media_assets").delete().eq("id", id);
  if (error) throw error;
}

// ── Reference emails (migration 015) ────────────────────────────────────────

export async function listReferenceEmails(
  brandId: string,
): Promise<ReferenceEmail[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("reference_emails")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) {
    // Pre-migration-015 DBs have no table yet; the library is just empty.
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as ReferenceEmail[];
}

export async function getReferenceEmail(id: string): Promise<ReferenceEmail | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("reference_emails")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as ReferenceEmail) ?? null;
}

export async function createReferenceEmail(args: {
  brandId: string;
  name: string;
  content: string;
  styleProfile: ReferenceEmailStyleProfile | null;
}): Promise<ReferenceEmail> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("reference_emails")
    .insert({
      brand_id: args.brandId,
      name: args.name.trim(),
      content: args.content,
      style_profile: args.styleProfile,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ReferenceEmail;
}

export async function deleteReferenceEmail(id: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("reference_emails").delete().eq("id", id);
  if (error) throw error;
}

// ── Competitor ad references (migration 025) ────────────────────────────────

export async function listCompetitorReferences(
  brandId: string,
): Promise<CompetitorReference[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("competitor_references")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) {
    // Pre-migration-025 DBs have no table yet; the library is just empty.
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as CompetitorReference[];
}

/** Used both to browse a single saved ad and, at generation time, to resolve
 * a brief's competitor_reference_id. Null on a stale id or a pre-025 DB. */
export async function getCompetitorReference(
  id: string,
): Promise<CompetitorReference | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("competitor_references")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as CompetitorReference) ?? null;
}

export async function createCompetitorReference(args: {
  brandId: string;
  name: string;
  inputKind: "text" | "image";
  content?: string | null;
  imageUrl?: string | null;
  storagePath?: string | null;
  sourceUrl?: string | null;
  competitorProfile: CompetitorProfile | null;
}): Promise<CompetitorReference> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("competitor_references")
    .insert({
      brand_id: args.brandId,
      name: args.name.trim(),
      input_kind: args.inputKind,
      content: args.content ?? null,
      image_url: args.imageUrl ?? null,
      storage_path: args.storagePath ?? null,
      source_url: args.sourceUrl?.trim() || null,
      competitor_profile: args.competitorProfile,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CompetitorReference;
}

/** Deletes the row only; the caller removes the storage object first (it has
 * the storage_path from getCompetitorReference), when input_kind='image'. */
export async function deleteCompetitorReference(id: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("competitor_references").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Archives (or unarchives) a draft: hides it from the default Emails list
 * without deleting its content or approval history.
 */
export async function archiveDraft(draftId: string, archived: boolean): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("drafts").update({ archived }).eq("id", draftId);
  if (error) throw error;
}

/**
 * Hard-deletes a draft. `approvals.draft_id` is ON DELETE CASCADE, so a draft's
 * approval history is cleaned up automatically; publications live on the job,
 * not the draft, so they're untouched. The caller MUST gate this on
 * `isJobPublished` returning false — a published draft is a permanent record
 * (archive it instead). The parent content_job and topic are deliberately left
 * in place: a delete should mean exactly "remove this draft," not a silent
 * status flip on the topic.
 */
export async function deleteDraft(draftId: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("drafts").delete().eq("id", draftId);
  if (error) throw error;
}

/** Every topic with its pillar, for the assistant's context and Home stats. */
export async function listTopics(brandId: string): Promise<
  Array<{
    id: string;
    title: string;
    pillar: string;
    funnel_stage: string | null;
    status: string;
  }>
> {
  const db = getAdminClient();

  // Walked in steps (strategy -> pillars -> clusters -> topics) rather than a
  // nested-filter select so this stays scoped to the caller's brand: topics
  // has no brand_id of its own, and without this a query for "all topics"
  // would hand back every brand's topics, not just this one's.
  const { data: strategy, error: stratErr } = await db
    .from("strategies")
    .select("id")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (stratErr) throw stratErr;
  if (!strategy) return [];

  const { data: pillars, error: pillarErr } = await db
    .from("pillars")
    .select("id")
    .eq("strategy_id", strategy.id);
  if (pillarErr) throw pillarErr;
  const pillarIds = (pillars ?? []).map((p) => p.id as string);
  if (pillarIds.length === 0) return [];

  const { data: clusters, error: clusterErr } = await db
    .from("clusters")
    .select("id")
    .in("pillar_id", pillarIds);
  if (clusterErr) throw clusterErr;
  const clusterIds = (clusters ?? []).map((c) => c.id as string);
  if (clusterIds.length === 0) return [];

  const { data, error } = await db
    .from("topics")
    .select(`id, title, funnel_stage, status, clusters ( pillars ( name ) )`)
    .in("cluster_id", clusterIds)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((t) => {
    const pillar =
      (t as { clusters?: { pillars?: { name?: string } | null } }).clusters
        ?.pillars?.name ?? "";
    return {
      id: t.id as string,
      title: t.title as string,
      pillar,
      funnel_stage: (t.funnel_stage as string | null) ?? null,
      status: t.status as string,
    };
  });
}

// ── Content schedules (recurring auto-generation, migration 010, plan 6) ────

/** All schedules for a brand, newest first. Degrades to [] pre-migration-010. */
export async function listContentSchedules(brandId: string): Promise<ContentSchedule[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("content_schedules")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as ContentSchedule[];
}

export async function getContentSchedule(id: string): Promise<ContentSchedule | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("content_schedules")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as ContentSchedule) ?? null;
}

export async function createContentSchedule(args: {
  brandId: string;
  channel: ContentJobType;
  cadence: Cadence;
  emailType?: EmailType;
  blogType?: BlogType;
}): Promise<ContentSchedule> {
  const db = getAdminClient();
  const { brandId, channel, cadence, emailType, blogType } = args;
  const { data, error } = await db
    .from("content_schedules")
    .insert({
      brand_id: brandId,
      channel,
      cadence,
      email_type: emailType ?? null,
      blog_type: blogType ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ContentSchedule;
}

export async function updateContentSchedule(
  id: string,
  patch: Partial<Pick<ContentSchedule, "cadence" | "active" | "email_type" | "blog_type">>,
): Promise<ContentSchedule> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("content_schedules")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as ContentSchedule;
}

export async function deleteContentSchedule(id: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("content_schedules").delete().eq("id", id);
  if (error) throw error;
}

/** Rows where the daily cron should run: active and due. */
export async function getDueSchedules(): Promise<ContentSchedule[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("content_schedules")
    .select("*")
    .eq("active", true)
    .lte("next_run_at", new Date().toISOString());
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as ContentSchedule[];
}

/** Records the outcome of a run attempt. `next_run_at` is left out on error so
 * the row stays due and the next cron tick retries automatically. */
export async function markScheduleRun(
  id: string,
  patch: { next_run_at?: string; last_run_at: string; last_result: string },
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("content_schedules").update(patch).eq("id", id);
  if (error) throw error;
}

/** The oldest non-archived, un-started ("idea") topic for a brand — the
 * "next unstarted topic" rule a schedule picks from. Walks strategies →
 * pillars → clusters → topics rather than a single deep-nested filter, same
 * step-by-step style as getTopicContext's reverse walk. Performance-informed
 * selection is deliberately deferred (phase 2). */
export async function getNextIdeaTopicId(brandId: string): Promise<string | null> {
  const db = getAdminClient();

  const { data: strategies, error: stratErr } = await db
    .from("strategies")
    .select("id")
    .eq("brand_id", brandId);
  if (stratErr) throw stratErr;
  const strategyIds = (strategies ?? []).map((s) => s.id as string);
  if (!strategyIds.length) return null;

  const { data: pillars, error: pillarErr } = await db
    .from("pillars")
    .select("id")
    .in("strategy_id", strategyIds);
  if (pillarErr) throw pillarErr;
  const pillarIds = (pillars ?? []).map((p) => p.id as string);
  if (!pillarIds.length) return null;

  const { data: clusters, error: clusterErr } = await db
    .from("clusters")
    .select("id")
    .in("pillar_id", pillarIds);
  if (clusterErr) throw clusterErr;
  const clusterIds = (clusters ?? []).map((c) => c.id as string);
  if (!clusterIds.length) return null;

  const { data: topic, error: topicErr } = await db
    .from("topics")
    .select("id")
    .in("cluster_id", clusterIds)
    .eq("status", "idea")
    .eq("archived", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (topicErr) throw topicErr;
  return (topic?.id as string) ?? null;
}

/** Count of currently in-review, non-archived drafts that a schedule (not a
 * human) triggered, for the dashboard badge. */
export async function countScheduledAwaitingReview(brandId: string): Promise<number> {
  const db = getAdminClient();
  const { count, error } = await db
    .from("drafts")
    .select("id, content_jobs!inner(brand_id, trigger_source)", {
      count: "exact",
      head: true,
    })
    .eq("state", "in_review")
    .eq("archived", false)
    .eq("content_jobs.brand_id", brandId)
    .eq("content_jobs.trigger_source", "schedule");
  if (error) throw error;
  return count ?? 0;
}

// ── User roles (migration 013) ──────────────────────────────────────────────

/** The caller's role, defaulting to 'user' if no profile row exists yet
 * (pre-migration, or a race with the on-signup trigger) — fail closed so a
 * missing row never grants admin-only access. */
export async function getUserRole(userId: string): Promise<UserRole> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("user_profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return "user";
    throw error;
  }
  return (data?.role as UserRole | undefined) ?? "user";
}

// ── Logs (migration 011) ───────────────────────────────────────────────────

/** The most recent app_logs rows, newest first. Powers the /logs page's
 * initial server-rendered feed. Degrades to [] pre-migration. */
export async function listRecentLogs(opts?: {
  level?: AppLogLevel;
  limit?: number;
}): Promise<AppLog[]> {
  const db = getAdminClient();
  let query = db
    .from("app_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.level) query = query.eq("level", opts.level);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as AppLog[];
}

/** Rows created after `since` (exclusive), oldest first, so the client's
 * poll loop can append them in order and advance its cursor to the last row's
 * created_at. Degrades to [] pre-migration. */
export async function listLogsSince(
  since: string,
  opts?: { level?: AppLogLevel; limit?: number },
): Promise<AppLog[]> {
  const db = getAdminClient();
  let query = db
    .from("app_logs")
    .select("*")
    .gt("created_at", since)
    .order("created_at", { ascending: true })
    .limit(opts?.limit ?? 500);
  if (opts?.level) query = query.eq("level", opts.level);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as AppLog[];
}

/** Counts/spend for the /logs page's stat tiles, last 24h. Degrades to all
 * zeroes pre-migration. */
export async function getLogStats(): Promise<{
  errorCount24h: number;
  warnCount24h: number;
  usageCount24h: number;
  estimatedUsd24h: number;
}> {
  const db = getAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("app_logs")
    .select("level, estimated_usd")
    .gte("created_at", since);
  if (error) {
    if (isMissingTableError(error)) {
      return { errorCount24h: 0, warnCount24h: 0, usageCount24h: 0, estimatedUsd24h: 0 };
    }
    throw error;
  }

  const rows = (data ?? []) as { level: AppLogLevel; estimated_usd: number | null }[];
  let errorCount24h = 0;
  let warnCount24h = 0;
  let usageCount24h = 0;
  let estimatedUsd24h = 0;
  for (const row of rows) {
    if (row.level === "error") errorCount24h++;
    else if (row.level === "warn") warnCount24h++;
    else if (row.level === "usage") {
      usageCount24h++;
      estimatedUsd24h += row.estimated_usd ?? 0;
    }
  }
  return {
    errorCount24h,
    warnCount24h,
    usageCount24h,
    estimatedUsd24h: Number(estimatedUsd24h.toFixed(4)),
  };
}

// ── Prompt capture (migration 021) ──────────────────────────────────────────

/** Summary columns only — `request` can be megabytes per row and the /prompts
 * list never needs it. Degrades to [] pre-migration. */
export async function listRecentPromptLogs(limit = 100): Promise<PromptLogSummary[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("prompt_logs")
    .select("id, created_at, provider, endpoint, model, preview, message_count, char_count")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as PromptLogSummary[];
}

/** One captured request in full, for the /prompts/[id] detail page. */
export async function getPromptLog(id: string): Promise<PromptLog | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("prompt_logs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as PromptLog) ?? null;
}

// ── Billing (migration 019) ───────────────────────────────────────────────────

/** A brand's Stripe mirror row, or null before it's ever bought/subscribed. */
export async function getBrandBilling(brandId: string): Promise<BrandBilling | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brand_billing")
    .select("*")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as BrandBilling) ?? null;
}

/**
 * Creates or updates the brand's Stripe mirror row. Callers pass only the
 * fields they know changed; brand_id is the upsert key (one row per brand).
 * Used by checkout (to persist a newly created Stripe Customer) and by the
 * webhook handlers (to sync subscription id/status/plan/period).
 */
export async function upsertBrandBilling(
  brandId: string,
  patch: Partial<Omit<BrandBilling, "brand_id" | "updated_at">>,
): Promise<BrandBilling> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brand_billing")
    .upsert(
      { brand_id: brandId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "brand_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as BrandBilling;
}

/** Looks up a brand's Stripe mirror row by their Stripe Customer id. Used by
 *  the subscription/invoice webhook handlers, which only carry a customer id,
 *  never a brand id (Stripe has no notion of our brands). */
export async function getBrandBillingByCustomerId(
  stripeCustomerId: string,
): Promise<BrandBilling | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brand_billing")
    .select("*")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return (data as BrandBilling) ?? null;
}

export interface BrandAllowanceState {
  brandId: string;
  planCode: PlanCode;
  lastAllowancePeriod: string | null;
}

/**
 * Every brand's plan and last-granted allowance period, for the daily
 * allowance cron to walk. Three flat selects joined in JS rather than a
 * Postgres join: at the brand counts this app runs at, the simplicity beats
 * the query, and it keeps the missing-table degrade (pre-019 DBs) trivial to
 * reason about per table instead of inside a join.
 */
export async function listBrandsForAllowance(): Promise<BrandAllowanceState[]> {
  const db = getAdminClient();
  const { data: brands, error: brandsErr } = await db.from("brands").select("id");
  if (brandsErr) throw brandsErr;
  if (!brands?.length) return [];

  const ids = brands.map((b) => b.id as string);
  const [billingRes, balanceRes] = await Promise.all([
    db.from("brand_billing").select("brand_id, plan_code").in("brand_id", ids),
    db.from("credits_balance").select("brand_id, last_allowance_period").in("brand_id", ids),
  ]);
  if (billingRes.error && !isMissingTableError(billingRes.error)) throw billingRes.error;
  if (balanceRes.error && !isMissingTableError(balanceRes.error)) throw balanceRes.error;

  const planByBrand = new Map<string, PlanCode>(
    (billingRes.data ?? []).map((r) => [r.brand_id as string, r.plan_code as PlanCode]),
  );
  const periodByBrand = new Map<string, string | null>(
    (balanceRes.data ?? []).map((r) => [r.brand_id as string, r.last_allowance_period as string | null]),
  );

  return ids.map((brandId) => ({
    brandId,
    planCode: planByBrand.get(brandId) ?? "free",
    lastAllowancePeriod: periodByBrand.get(brandId) ?? null,
  }));
}

export interface UsageBreakdownRow {
  /** The `source` label passed to logUsage/logTokenUsage (e.g. "generate-email",
   *  "redesign", "adjust-style") — this app's closest thing to an action type. */
  source: string;
  count: number;
  estimatedUsd: number;
}

/** This month's `app_logs` usage rows for a brand, grouped by action type
 *  (the `source` column) and summed. Powers the /billing usage breakdown
 *  chart. Grouped in JS rather than a Postgres `group by`: at one brand's
 *  monthly row count this is cheap, and it keeps the missing-table/column
 *  degrade (pre-018 DBs) as simple as every other billing query here. */
export async function getUsageBreakdown(brandId: string): Promise<UsageBreakdownRow[]> {
  const db = getAdminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await db
    .from("app_logs")
    .select("source, estimated_usd")
    .eq("brand_id", brandId)
    .eq("level", "usage")
    .gte("created_at", monthStart);
  if (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) return [];
    throw error;
  }

  const totals = new Map<string, { count: number; estimatedUsd: number }>();
  for (const row of (data ?? []) as { source: string; estimated_usd: number | null }[]) {
    const entry = totals.get(row.source) ?? { count: 0, estimatedUsd: 0 };
    entry.count += 1;
    entry.estimatedUsd += row.estimated_usd ?? 0;
    totals.set(row.source, entry);
  }
  return Array.from(totals.entries())
    .map(([source, v]) => ({ source, count: v.count, estimatedUsd: Number(v.estimatedUsd.toFixed(4)) }))
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd);
}

export interface CreditTransactionRow {
  id: string;
  delta: number;
  reason: string;
  sourceId: string | null;
  usdReference: number | null;
  createdAt: string;
}

/** A brand's credit ledger, newest first. Powers the /billing transaction
 *  history table. Reads straight off credit_transactions, the append-only
 *  audit table, never off the cached balance. */
export async function listCreditTransactions(
  brandId: string,
  limit = 50,
): Promise<CreditTransactionRow[]> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("credit_transactions")
    .select("id, delta, reason, source_id, usd_reference, created_at")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    delta: r.delta as number,
    reason: r.reason as string,
    sourceId: r.source_id as string | null,
    usdReference: r.usd_reference as number | null,
    createdAt: r.created_at as string,
  }));
}

/** Stamps the period a brand's monthly allowance was last granted for, without
 *  touching its balance (grant_credits already moved that). Upsert only sets
 *  the columns passed, so an existing balance is never clobbered. */
export async function markAllowanceGranted(brandId: string, period: string): Promise<void> {
  const db = getAdminClient();
  const { error } = await db
    .from("credits_balance")
    .upsert(
      { brand_id: brandId, last_allowance_period: period, updated_at: new Date().toISOString() },
      { onConflict: "brand_id" },
    );
  if (error) throw error;
}
