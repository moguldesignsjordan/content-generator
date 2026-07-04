import "server-only";
import { getAdminClient } from "./client";
import type {
  Brand,
  BrandGuidelines,
  Campaign,
  CampaignBrief,
  CampaignChatState,
  CampaignStatus,
  DraftForReview,
  DraftJobContext,
  DraftMeta,
  DraftSeoData,
  EmailDraftContent,
  Icp,
  IcpProfile,
  MailerliteConfig,
  OnboardingState,
  PillarWithClusters,
  Positioning,
  Product,
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
      console.warn(
        "[queries] products table missing, apply db/migrations/002 to enable offer context",
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
export async function persistEmailDraft(args: {
  ctx: TopicContext;
  content: EmailDraftContent;
  meta?: DraftMeta;
  seoData?: DraftSeoData;
  campaignId?: string;
}): Promise<string> {
  const db = getAdminClient();
  const { ctx, content, meta, seoData, campaignId } = args;

  // campaign_id only when a campaign drove the draft, so plain generation
  // still works before migration 002 adds the column.
  const { data: job, error: jobErr } = await db
    .from("content_jobs")
    .insert({
      brand_id: ctx.brand.id,
      topic_id: ctx.topic.id,
      type: "email",
      status: "in_review",
      trigger_source: campaignId ? "campaign" : "manual",
      ...(campaignId ? { campaign_id: campaignId } : {}),
    })
    .select("id")
    .single();
  if (jobErr) throw jobErr;

  const { data: draft, error: draftErr } = await db
    .from("drafts")
    .insert({
      job_id: job.id,
      version: 1,
      content,
      meta: meta ?? {},
      seo_data: seoData ?? {},
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

/** Loads the minimal context the regeneration pipeline needs for a draft. */
export async function getDraftWithJobContext(
  draftId: string,
): Promise<DraftJobContext | null> {
  const db = getAdminClient();

  // Falls back to a campaign-less select before migration 002 adds the column.
  let { data, error } = await db
    .from("drafts")
    .select(`id, job_id, version, content, content_jobs!inner(topic_id, campaign_id)`)
    .eq("id", draftId)
    .maybeSingle();
  if (error) {
    ({ data, error } = await db
      .from("drafts")
      .select(`id, job_id, version, content, content_jobs!inner(topic_id)`)
      .eq("id", draftId)
      .maybeSingle());
  }
  if (error) throw error;
  if (!data) return null;

  const job = (
    data as {
      content_jobs?: { topic_id?: string; campaign_id?: string | null } | null;
    }
  ).content_jobs;

  return {
    draftId: data.id as string,
    jobId: data.job_id as string,
    topicId: job?.topic_id ?? "",
    campaignId: job?.campaign_id ?? null,
    version: data.version as number,
    content: data.content as EmailDraftContent,
  };
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
): Promise<void> {
  const db = getAdminClient();
  const { error } = await db.from("drafts").update({ content }).eq("id", draftId);
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
  if (editedMeta) update.meta = editedMeta;

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
}): Promise<string> {
  const db = getAdminClient();
  const { jobId, version, content, meta, seoData } = args;

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
  return data.id as string;
}

/** Loads a draft with its topic title for the review screen. */
export async function getDraftForReview(
  draftId: string,
): Promise<DraftForReview | null> {
  const db = getAdminClient();

  const { data, error } = await db
    .from("drafts")
    .select(
      `id, version, state, content, meta, seo_data, created_at,
       content_jobs!inner ( topics ( title ) )`,
    )
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Supabase types the embedded relations loosely; narrow defensively.
  const job = (data as { content_jobs?: { topics?: { title?: string } | null } })
    .content_jobs;
  const topicTitle = job?.topics?.title ?? null;

  return {
    id: data.id,
    version: data.version,
    state: data.state,
    content: data.content as EmailDraftContent,
    meta: (data.meta ?? {}) as DraftMeta,
    seo_data: (data.seo_data ?? {}) as DraftSeoData,
    topic_title: topicTitle,
    created_at: data.created_at,
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
 * True when a query failed because the table doesn't exist yet (migration not
 * applied). PGRST205 is PostgREST's "table not in schema cache"; 42P01 is
 * Postgres "undefined_table".
 */
function isMissingTableError(err: { code?: string; message?: string }): boolean {
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    (err.message ?? "").includes("schema cache")
  );
}

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
    console.warn(
      "[queries] products table missing, apply db/migrations/002 to enable products",
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

// ── Flat list queries (dashboard Emails tab + assistant context) ──────────────

/** A flat list of every email draft, newest first, with its topic title. */
export async function listDrafts(): Promise<
  Array<{
    id: string;
    topic_title: string | null;
    subject: string;
    state: string;
    version: number;
    created_at: string;
  }>
> {
  const db = getAdminClient();
  const { data, error } = await db
    .from("drafts")
    .select(
      `id, version, state, created_at, content,
       content_jobs!inner ( topics ( title ) )`,
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  return (data ?? []).map((d) => {
    const job = (
      d as { content_jobs?: { topics?: { title?: string } | null } }
    ).content_jobs;
    const content = d.content as EmailDraftContent | null;
    return {
      id: d.id as string,
      version: d.version as number,
      state: d.state as string,
      created_at: d.created_at as string,
      topic_title: job?.topics?.title ?? null,
      subject: content?.subject ?? "",
    };
  });
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
