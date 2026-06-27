import "server-only";
import { getAdminClient } from "./client";
import type {
  Brand,
  DraftForReview,
  DraftJobContext,
  EmailDraftContent,
  Icp,
  PillarWithClusters,
  Strategy,
  Topic,
  TopicContext,
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

  return {
    brand: brand as Brand,
    strategy: strategy as Strategy,
    pillars: (pillars ?? []) as PillarWithClusters[],
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

  return {
    topic: topic as Topic,
    brand: brand as Brand,
    strategy: strategy as Strategy,
    primaryIcp: (icps?.[0] as Icp) ?? null,
  };
}

/**
 * Persists a generated email as draft v1: creates a content_jobs row, a drafts
 * row (state in_review), and marks the topic in_progress. Returns the draft id.
 */
export async function persistEmailDraft(args: {
  ctx: TopicContext;
  content: EmailDraftContent;
}): Promise<string> {
  const db = getAdminClient();
  const { ctx, content } = args;

  const { data: job, error: jobErr } = await db
    .from("content_jobs")
    .insert({
      brand_id: ctx.brand.id,
      topic_id: ctx.topic.id,
      type: "email",
      status: "in_review",
      trigger_source: "manual",
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

  const { data, error } = await db
    .from("drafts")
    .select(`id, job_id, version, content, content_jobs!inner(topic_id)`)
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const job = (data as { content_jobs?: { topic_id?: string } | null })
    .content_jobs;

  return {
    draftId: data.id as string,
    jobId: data.job_id as string,
    topicId: job?.topic_id ?? "",
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
 * Approves a draft. If editedContent is supplied the draft's content is updated
 * first and the decision is recorded as "edited"; otherwise it's "approved".
 */
export async function approveDraft(
  draftId: string,
  editedContent?: EmailDraftContent,
): Promise<void> {
  const db = getAdminClient();
  const decision = editedContent ? "edited" : "approved";

  const update: Record<string, unknown> = { state: "approved" };
  if (editedContent) update.content = editedContent;

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
}): Promise<string> {
  const db = getAdminClient();
  const { jobId, version, content } = args;

  const { data, error } = await db
    .from("drafts")
    .insert({ job_id: jobId, version, content, state: "in_review" })
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
      `id, version, state, content, created_at,
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
    topic_title: topicTitle,
    created_at: data.created_at,
  };
}
