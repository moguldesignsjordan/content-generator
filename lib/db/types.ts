// Row types mirroring db/schema.sql. Hand-maintained for v1; once Supabase is
// live you can replace these with generated types (`supabase gen types`).

export type FunnelStage = "awareness" | "consideration" | "decision" | "brand";
export type TopicStatus = "idea" | "queued" | "in_progress" | "published";

export interface IcpProfile {
  demographics?: string;
  values?: string[];
  jobs_to_be_done?: string[];
  pains?: string[];
  triggers?: string[];
  objections?: string[];
  awareness_stage?: string;
  vocabulary?: string[];
}

export interface VoiceProfile {
  voice?: string;
  tone?: string;
  example_posts?: string[];
  banned_terms?: string[];
  cta_library?: Record<string, string>;
}

export interface Brand {
  id: string;
  name: string;
  voice_profile: VoiceProfile;
  sanity_config: Record<string, unknown>;
  mailerlite_config: Record<string, unknown>;
  seo_defaults: Record<string, unknown>;
  created_at: string;
}

export interface Strategy {
  id: string;
  brand_id: string;
  funnel_definition: Record<string, { cta_type: string }>;
  updated_at: string;
}

export interface Icp {
  id: string;
  strategy_id: string;
  label: string;
  is_primary: boolean;
  profile: IcpProfile;
}

export interface Pillar {
  id: string;
  strategy_id: string;
  name: string;
  description: string | null;
  business_goal: string | null;
  primary_funnel_stage: FunnelStage;
  target_icp_id: string | null;
}

export interface Cluster {
  id: string;
  pillar_id: string;
  hub_title: string;
  hub_keyword: string | null;
  hub_intent: string | null;
}

export interface Topic {
  id: string;
  cluster_id: string;
  title: string;
  target_keyword: string | null;
  intent: string | null;
  funnel_stage: FunnelStage | null;
  internal_link_targets: string[];
  maps_to_product: string | null;
  distribution_recipe: string[];
  status: TopicStatus;
  published_url: string | null;
  created_at: string;
}

// Shape returned by the dashboard query: topics nested under cluster → pillar.
export interface ClusterWithTopics extends Cluster {
  topics: Topic[];
}
export interface PillarWithClusters extends Pillar {
  clusters: ClusterWithTopics[];
}

// Everything the generate pipeline needs to draft an on-strategy email for one
// topic (assembled by getTopicContext).
export interface TopicContext {
  topic: Topic;
  brand: Brand;
  strategy: Strategy;
  primaryIcp: Icp | null;
}

// What we store in drafts.content for an email draft.
export interface EmailDraftContent {
  subject: string;
  preheader: string;
  html: string;
}

// Shape returned by getDraftForReview: a draft plus the topic it belongs to.
export interface DraftForReview {
  id: string;
  version: number;
  state: string;
  content: EmailDraftContent;
  topic_title: string | null;
  created_at: string;
}

// Minimal context needed by the regeneration pipeline.
export interface DraftJobContext {
  draftId: string;
  jobId: string;
  topicId: string;
  version: number;
  content: EmailDraftContent;
}
