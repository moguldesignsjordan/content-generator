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

// Channel-tagged voice examples: the email prompt prefers "email" examples,
// blog/social generation will prefer theirs. example_posts (untagged) remains
// as a legacy read fallback.
export type VoiceExampleChannel = "email" | "social" | "blog";

export interface VoiceExample {
  channel: VoiceExampleChannel;
  content: string;
}

export interface VoiceProfile {
  voice?: string;
  tone?: string;
  example_posts?: string[];
  examples?: VoiceExample[];
  banned_terms?: string[];
  cta_library?: Record<string, string>;
}

// ── Visual identity: deterministic tokens the email templates render ────────

export interface BrandColors {
  primary?: string; // hex
  secondary?: string;
  accent?: string; // CTA button color
  background?: string;
  text?: string;
  muted?: string; // footer / meta
}

export interface BrandFonts {
  heading?: string; // font-family string, e.g. "Georgia, serif"
  body?: string; // e.g. "Inter, system-ui, sans-serif"
}

export interface SocialLinks {
  linkedin?: string;
  twitter?: string;
  instagram?: string;
  youtube?: string;
}

export interface BrandFooter {
  contact_email?: string;
  website?: string;
  social?: SocialLinks;
}

export interface VisualIdentity {
  logo_url?: string;
  logo_alt?: string;
  colors?: BrandColors;
  fonts?: BrandFonts;
  footer?: BrandFooter;
}

// ── Positioning: context the generation prompt reads to sharpen copy ────────

export interface Positioning {
  business_description?: string;
  tagline?: string;
  differentiators?: string[]; // what separates the business
  competitors?: string[];
}

// ── Onboarding: the chatbot conversation state, persisted for resume ────────

export interface OnboardingMessage {
  role: "user" | "assistant";
  content: string;
}

export interface OnboardingState {
  messages?: OnboardingMessage[];
  completed?: boolean;
}

// ── Brand guidelines: synthesized by Claude from everything stored, edited and
//    explicitly saved by a human, then injected into every generation prompt ──

export interface BrandGuidelines {
  voice_and_tone?: string;
  messaging_pillars?: string[];
  do_language?: string[];
  dont_language?: string[];
  audience_summary?: string;
  visual_direction?: string;
  cta_philosophy?: string;
  approved_at?: string; // ISO timestamp set on save
}

export interface MailerliteConfig {
  sender_name?: string;
  sender_email?: string;
  group_ids?: string[];
}

export interface SeoDefaults {
  geography?: string;
  language?: string;
  keyword_difficulty_max?: number;
}

export interface Brand {
  id: string;
  name: string;
  voice_profile: VoiceProfile;
  visual_identity: VisualIdentity;
  positioning: Positioning;
  guidelines: BrandGuidelines;
  onboarding_state: OnboardingState;
  sanity_config: Record<string, unknown>;
  mailerlite_config: MailerliteConfig;
  seo_defaults: SeoDefaults;
  created_at: string;
}

export interface TopicFormData {
  title: string;
  target_keyword: string;
  intent: string;
  funnel_stage: FunnelStage | "";
  maps_to_product: string;
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

// ── Products: the real offers behind topics.maps_to_product slugs ───────────

export interface Product {
  id: string;
  brand_id: string;
  slug: string;
  name: string;
  description: string | null;
  deliverables: string[];
  price_point: string | null;
  url: string | null;
  created_at: string;
}

// ── Website import: the proposal the scrape-and-extract flow returns. Lives
//    here (not lib/scrape) because client review components import it and it
//    composes the DB shapes above. Nothing persists until the user saves. ────

export interface ProposedProduct {
  slug: string;
  name: string;
  description?: string;
  deliverables?: string[];
  price_point?: string;
  url?: string;
}

export interface BrandImportProposal {
  voice_profile?: Pick<
    VoiceProfile,
    "voice" | "tone" | "banned_terms" | "example_posts"
  >;
  positioning?: Positioning;
  products?: ProposedProduct[];
  visual_identity?: VisualIdentity; // logo_url already mirrored to storage
  audience_summary?: string;
  source_url: string;
  pages_scraped: string[];
}

// ── Campaigns: one strategic interview that briefs a piece of content ───────

export type CampaignStatus = "briefing" | "generating" | "drafted" | "done";

export interface CampaignBrief {
  goal?: string;
  audience_notes?: string;
  key_message?: string;
  offer_slug?: string;
  angle?: string;
  constraints?: string;
}

export interface CampaignChatState {
  messages?: OnboardingMessage[];
}

export interface Campaign {
  id: string;
  brand_id: string;
  topic_id: string | null;
  brief: CampaignBrief;
  chat_state: CampaignChatState;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
}

// Everything the generate pipeline needs to draft an on-strategy email for one
// topic (assembled by getTopicContext). product resolves the topic's
// maps_to_product slug to a real offer (null when the slug has no row).
export interface TopicContext {
  topic: Topic;
  brand: Brand;
  strategy: Strategy;
  primaryIcp: Icp | null;
  product: Product | null;
}

// What we store in drafts.content for an email draft.
export interface EmailDraftContent {
  subject: string;
  preheader: string;
  html: string;
}

// The structured copy Claude produces; the email templates render it into HTML.
// Stored on drafts.meta so a draft remembers the copy that produced its HTML.
export type EmailTemplateId =
  | "newsletter_tip"
  | "newsletter_feature"
  | "newsletter_howto";

export interface EmailCopySection {
  heading?: string;
  body: string;
}

export interface EmailCopy {
  subject: string;
  preheader: string;
  headline: string;
  body_sections: EmailCopySection[];
  cta_text: string;
  cta_url?: string;
}

// What we store in drafts.meta, SEO fields generated by the QA pass, plus the
// template id + copy that produced this draft's HTML (enables future re-render).
// email_design_source records whether the HTML came from the model's design
// (under the email design system prompt) or the code template fallback.
export interface DraftMeta {
  meta_title?: string;
  meta_description?: string;
  email_template_id?: EmailTemplateId;
  email_copy?: EmailCopy;
  email_design_source?: "model" | "template";
}

// What we store in drafts.seo_data, QA findings from the second Claude pass.
export interface DraftSeoData {
  keyword_used?: boolean;
  keyword_placement?: string;
  banned_terms_found?: string[];
  readability_note?: string;
  qa_pass?: boolean;
  issues?: string[];
}

// Shape returned by getDraftForReview: a draft plus the topic it belongs to.
export interface DraftForReview {
  id: string;
  version: number;
  state: string;
  content: EmailDraftContent;
  meta: DraftMeta;
  seo_data: DraftSeoData;
  topic_title: string | null;
  created_at: string;
}

// Minimal context needed by the regeneration pipeline.
export interface DraftJobContext {
  draftId: string;
  jobId: string;
  topicId: string;
  campaignId: string | null;
  version: number;
  content: EmailDraftContent;
}
