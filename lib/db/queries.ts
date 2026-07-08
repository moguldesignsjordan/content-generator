import "server-only";
import { getAdminClient } from "./client";
import { isMissingTableError } from "./table-guard";
import { logError, logWarn } from "@/lib/log";
import type {
  AppLog,
  AppLogLevel,
  Brand,
  BrandGuidelines,
  BrandMemory,
  Cadence,
  Campaign,
  CampaignBrief,
  CampaignChatState,
  CampaignPublishProgress,
  CampaignStatus,
  ContentJobType,
  ContentSchedule,
  DraftForReview,
  DraftGenerationState,
  DraftJobContext,
  DraftListRow,
  DraftMeta,
  DraftSeoData,
  EmailDraftContent,
  EmailType,
  BlogType,
  Icp,
  IcpProfile,
  KeywordData,
  MailerliteConfig,
  OnboardingState,
  PerformanceMetric,
  PillarWithClusters,
  Positioning,
  Product,
  PublicationRecord,
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
 * Loads the brand's strategy tree for the dashboard: pillars → clusters →
 * topics (spokes). One round-trip via Supabase's nested select.
 *
 * Returns null if no brand has been seeded yet.
 */
export async function getBrandStrategy(): Promise<{
  brand: Brand;
  strategy: Strategy;
  pillars: PillarWithClusters[];
  latestDraftByTopic: Record<string, { id: string; state: string; version: number }>;
} | null> {
  const db = getAdminClient();

  const { data: brand, error: brandErr } = await db
    .from("brands")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (brandErr) throw brandErr;
  if (!brand) return null;

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

  return {
    topic: topic as Topic,
    brand: brand as Brand,
    strategy: strategy as Strategy,
    primaryIcp: (icps?.[0] as Icp) ?? null,
    product,
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
): Promise<DraftJobContext | null> {
  const db = getAdminClient();

  // Falls back to a campaign-less select before migration 002 adds the column.
  let { data, error } = await db
    .from("drafts")
    .select(
      `id, job_id, version, content, meta, state, content_jobs!inner(topic_id, campaign_id, type, email_type, blog_type)`,
    )
    .eq("id", draftId)
    .maybeSingle();
  if (error) {
    ({ data, error } = await db
      .from("drafts")
      .select(
        `id, job_id, version, content, meta, state, content_jobs!inner(topic_id, type, email_type, blog_type)`,
      )
      .eq("id", draftId)
      .maybeSingle());
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
): Promise<DraftForReview | null> {
  const db = getAdminClient();

  // Falls back to an archived-less select before migration 003 adds the
  // column, so this doesn't hard-break every draft page in the meantime.
  let { data, error } = await db
    .from("drafts")
    .select(
      `id, version, state, content, meta, seo_data, archived, created_at,
       content_jobs!inner ( type, topics ( title ) )`,
    )
    .eq("id", draftId)
    .maybeSingle();
  if (error) {
    ({ data, error } = await db
      .from("drafts")
      .select(
        `id, version, state, content, meta, seo_data, created_at,
         content_jobs!inner ( type, topics ( title ) )`,
      )
      .eq("id", draftId)
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
  };
}

// ── Settings queries ──────────────────────────────────────────────────────────

/** Returns the single brand row, or null if none has been created yet. */
export async function getSingleBrand(): Promise<Brand | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brands")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Brand) ?? null;
}

/**
 * Creates a minimal brand row (name only), the first step of onboarding when
 * no brand exists yet. Subsequent onboarding steps fill in the profile via the
 * per-section update functions. Returns the new brand.
 */
export async function createBrand(name: string): Promise<Brand> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("brands")
    .insert({ name: name.trim() })
    .select("*")
    .single();
  if (error) throw error;
  return data as Brand;
}

/** Loads the brand, strategy, and all ICPs for the settings page. */
export async function getBrandWithIcps(): Promise<{
  brand: Brand;
  strategy: Strategy | null;
  icps: Icp[];
} | null> {
  const db = getAdminClient();

  const { data: brand, error: brandErr } = await db
    .from("brands")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (brandErr) throw brandErr;
  if (!brand) return null;

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
  options?: { jobType?: ContentJobType },
): Promise<DraftListRow[]> {
  const db = getAdminClient();
  const { jobType } = options ?? {};

  let data: Record<string, unknown>[] | null;
  let error: { message: string } | null;

  // Primary select (post-migration-003, includes archived). Scoped to one kind
  // when jobType is given (the Emails/Blogs tabs each pass theirs).
  let primary = db.from("drafts").select(
    `id, version, state, archived, created_at, content, meta,
     content_jobs!inner ( type, topics ( title ) )`,
  );
  if (jobType) primary = primary.eq("content_jobs.type", jobType);
  ({ data, error } = await primary
    .order("created_at", { ascending: false })
    .limit(100));

  if (error) {
    // Fallback: archived-less select for DBs predating migration 003.
    let fallback = db.from("drafts").select(
      `id, version, state, created_at, content, meta,
       content_jobs!inner ( type, topics ( title ) )`,
    );
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
): Promise<{ draftId: string; subject: string } | null> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("drafts")
    .select("id, content")
    .eq("meta->>source_draft_id", emailDraftId)
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
export async function listTopics(): Promise<
  Array<{
    id: string;
    title: string;
    pillar: string;
    funnel_stage: string | null;
    status: string;
  }>
> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("topics")
    .select(`id, title, funnel_stage, status, clusters ( pillars ( name ) )`)
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
