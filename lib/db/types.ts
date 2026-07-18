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

// Brand-level email length preference: scales the per-type word budgets in
// prompts/generate-email.ts (see resolveLengthTarget). "standard" (or unset)
// keeps the base EMAIL_LENGTH_TARGETS ranges.
export type EmailLengthPreference = "short" | "standard" | "long";

export interface VoiceProfile {
  voice?: string;
  tone?: string;
  example_posts?: string[];
  examples?: VoiceExample[];
  banned_terms?: string[];
  cta_library?: Record<string, string>;
  email_length?: EmailLengthPreference;
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
  // CAN-SPAM/GDPR require a physical postal address in marketing email.
  // Rendered muted in the footer next to the unsubscribe link.
  postal_address?: string;
}

// Brand-level image generation preference, set during onboarding or in
// Settings → Visual identity. `auto` means every new email/blog draft gets a
// generated hero image; the human approval gate still applies to the whole
// draft, image included, before anything publishes.
// `brand_palette` controls whether generated images are steered toward the
// brand's colors: "auto" (default) lets each style decide (realistic photos
// stay natural, graphic styles get brand accents), "always"/"never" force it.
export type BrandPalettePref = "auto" | "always" | "never";

export interface ImageGenPrefs {
  auto?: boolean;
  style?: ContentImageStyle;
  brand_palette?: BrandPalettePref;
}

export interface VisualIdentity {
  logo_url?: string;
  logo_alt?: string;
  colors?: BrandColors;
  fonts?: BrandFonts;
  footer?: BrandFooter;
  image_gen?: ImageGenPrefs;
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

// ── Keyword research: DataForSEO-validated numbers for a topic's keyword ────
// (migration 008, Slice 4 "enrich" cut). A topic starts with a guessed
// target_keyword; tapping "Research" fills this in with real search data.
// "Researched" = !!keyword_data.primary.

export interface KeywordMetric {
  keyword: string;
  search_volume: number | null;
  difficulty: number | null; // 0-100, DataForSEO keyword_difficulty
  intent: string | null; // informational | navigational | commercial | transactional
  cpc: number | null;
  competition: string | null; // LOW | MEDIUM | HIGH
}

export interface KeywordData {
  primary?: KeywordMetric;
  secondary?: KeywordMetric[];
  location?: string;
  language?: string;
  researched_at?: string; // ISO timestamp
  source?: string; // "dataforseo"
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
  archived: boolean;
  keyword_data: KeywordData;
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
  // A real photo of the product (migration 022), offered as the default
  // hero image for product emails instead of an AI-imagined stand-in.
  image_url: string | null;
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
  // Present for website-derived proposals; absent for from-scratch generation
  // (e.g. the brand-identity generator, which has no pages to cite).
  source_url?: string;
  pages_scraped?: string[];
}

// ── Brand memory: durable facts the create agent learns and recalls ─────────
// (migration 007). Distinct from voice_profile, which only changes via the
// explicit propose/confirm flow; these are written directly by the agent's
// `remember` tool when the user states a durable preference, decision, or
// constraint.

export interface BrandMemory {
  id: string;
  brand_id: string;
  content: string;
  kind: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

// ── Campaigns: one strategic interview that briefs a piece of content ───────

export type CampaignStatus = "briefing" | "generating" | "drafted" | "done";

/** The visual/verbal energy the user asked for, captured in the interview and
 * consumed by image style and email design-style selection. */
export type VisualVibe = "punchy" | "sleek" | "playful" | "premium";

export interface CampaignBrief {
  goal?: string;
  audience_notes?: string;
  key_message?: string;
  offer_slug?: string;
  angle?: string;
  constraints?: string;
  /** Per-piece tone override; unset means the stored brand voice as-is. */
  tone?: string;
  /** Full text of an example email the user pasted for THIS piece: generation
   * matches its length, structure, and register, never its content. Kept
   * verbatim (no em-dash stripping): it's the user's own reference material. */
  style_example?: string;
  /** Per-piece length override. Wins over the brand-level
   * voice_profile.email_length; unset falls back to it. */
  length?: EmailLengthPreference;
  /** Per-piece hero-image choice. true forces an image even when the brand's
   * auto-image setting is off; false skips it even when auto is on; unset
   * leaves the brand setting in charge. */
  include_image?: boolean;
  /** The energy the user wants this piece to feel like. Drives image style
   * and email design-style selection (see prompts/email-styles.ts and
   * prompts/generate-image.ts). */
  visual_vibe?: VisualVibe;
  /** An explicit art-style choice for this piece's generated hero image
   * (campaign form / interview answer). Wins over the vibe→style mapping,
   * the brand's stored default, and the varied fallback rotation. */
  image_style?: ContentImageStyle;
  /** A real, already-hosted photo (usually the mapped product's own image)
   * to use as the hero AS-IS instead of generating one. Only ever set from a
   * known-good URL: the selected product's stored image_url, or a photo the
   * user uploaded through the interview, never invented by the model. */
  product_photo_url?: string;
}

/** One draft created as part of a multi-email series (plan_series), kept in
 * chat_state so the chat can re-render the series card on reload. */
export interface SeriesDraftRef {
  draft_id: string;
  title: string;
  email_type?: string | null;
}

export interface CampaignChatState {
  messages?: OnboardingMessage[];
  series?: SeriesDraftRef[];
}

export interface Campaign {
  id: string;
  brand_id: string;
  topic_id: string | null;
  brief: CampaignBrief;
  chat_state: CampaignChatState;
  status: CampaignStatus;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

/** How far a campaign's emails have gotten toward MailerLite, for the
 * Campaigns list page. Counts only "email" content_jobs (blogs publish to
 * Sanity, which has no send/schedule concept). */
export interface CampaignPublishProgress {
  emails: number;
  sent: number;
  scheduled: number;
}

export type CampaignSummary = Campaign & CampaignPublishProgress;

// Everything the generate pipeline needs to draft an on-strategy email for one
// topic (assembled by getTopicContext). product resolves the topic's
// maps_to_product slug to a real offer (null when the slug has no row).
export interface TopicContext {
  topic: Topic;
  brand: Brand;
  strategy: Strategy;
  primaryIcp: Icp | null;
  product: Product | null;
  /** The brand's reference email library (migration 015), newest first.
   * Optional so pre-migration DBs and older call sites degrade to "none". */
  referenceEmails?: ReferenceEmail[];
  /** Uploaded email DESIGN references (migration 016), newest first: emails the
   * user liked the look of, whose layout generation recreates. Optional for the
   * same reason as referenceEmails. */
  emailDesignRefs?: StyleReference[];
}

// What we store in drafts.content for an email draft.
export interface EmailDraftContent {
  subject: string;
  preheader: string;
  html: string;
}

// The structured copy Claude produces; the email templates render it into HTML.
// Stored on drafts.meta so a draft remembers the copy that produced its HTML.
// "Layout" = content SHAPE (tip vs feature vs steps vs digest...), orthogonal
// to EmailStyleId ("visual identity": card frame, accent treatment, radius).
// A given email combines one of each (see resolveEmailLayout + pickEmailStyle
// in prompts/generate-email.ts / prompts/email-styles.ts).
export type EmailTemplateId =
  | "newsletter_tip"
  | "newsletter_feature"
  | "newsletter_howto"
  | "promotional_bold"
  | "announcement_banner"
  | "product_spotlight"
  | "digest";

// A curated visual design direction (page background, card frame, header
// style, accent treatment, CTA shape, radius, whitespace). Rotated
// (no-consecutive-repeats) across generations so emails vary in look while
// staying professional and email-safe; see prompts/email-styles.ts.
export type EmailStyleId =
  | "soft_card"
  | "editorial_serif"
  | "bold_accent_band"
  | "minimal_mono"
  | "bordered_ledger"
  | "left_rule_editorial"
  | "pill_modern"
  | "warm_gradient_top";

// The marketing PURPOSE of an email. Kept deliberately separate from
// EmailTemplateId (which is layout) and FunnelStage (which picks the CTA):
// email_type picks length, depth, and tone. Derived deterministically at
// generation time from the topic plus any campaign brief (see resolveEmailType
// in prompts/generate-email.ts), so every existing topic gets a type with no
// migration. A future content_jobs.email_type column makes it settable per job.
export type EmailType =
  | "newsletter"
  | "product"
  | "service"
  | "promotional"
  | "announcement";

// The FORMAT of a blog post, which sets its length and depth budget. Derived
// from the topic's title and search intent (see resolveBlogType in
// prompts/generate-blog.ts), so every existing topic gets a type with no
// migration. Orthogonal to funnel stage and to the email-side EmailType.
export type BlogType =
  | "pillar"
  | "how_to"
  | "listicle"
  | "case_study"
  | "thought_leadership"
  | "landing";

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
  // Alternative subject lines from the same generation call (near-zero extra
  // cost). The reviewer picks one on the draft screen; `subject` stays the
  // one currently chosen.
  subject_variants?: string[];
}

// What we store in drafts.meta, SEO fields generated by the QA pass, plus the
// template id + copy that produced this draft's HTML (enables future re-render).
// email_design_source records whether the HTML came from the model's design
// (under the email design system prompt) or the code template fallback.
// Which kind of in-place edit pushed an entry onto the undo stack, so the
// history log can label itself. The stack itself is shared (one Undo button
// covers all of them); this is purely for display.
export type EditType = "style" | "copy" | "recolor" | "image" | "delete";

// ── AI-generated content images (hero image in emails, blog hero later) ─────

export type ContentImageStyle =
  | "illustration"
  | "photo"
  | "texture"
  | "render3d"
  | "collage"
  | "lineart"
  | "watercolor"
  | "retro"
  | "duotone";

/** How an attached reference image steers generation. */
export type ReferenceUse = "style" | "subject" | "both";

/** Whether one generated image leans on the brand's colors or stays neutral. */
export type BrandPaletteMode = "accents" | "none";

/** Where the hero image sits in an email's layout. */
export type HeroPlacement = "top" | "below_headline" | "above_cta";

export interface ContentImage {
  url: string; // absolute HTTPS URL on Supabase Storage
  alt: string; // meaningful alt text (accessibility + images-blocked fallback)
  width: number;
  height: number;
  // "uploaded" marks a user-provided image (no generation involved).
  style: ContentImageStyle | "uploaded";
  // Undefined on images placed before placement existed; treated as "top".
  placement?: HeroPlacement;
  // The final prompt sent to the image model (absent on uploads and on
  // images generated before this existed). Shown in the image sheet so the
  // user can see exactly what produced the render, tweak it, and regenerate.
  prompt?: string;
  // Whether this render was steered toward brand colors ("accents") or left
  // neutral ("none"). Absent on uploads, exact-prompt renders, and images
  // generated before this existed. Initializes the image sheet's toggle.
  brand_palette?: BrandPaletteMode;
}

/** How the user's typed subject is treated when generating an image. */
export type ImagePromptMode = "auto" | "exact";

// ── Media library (migration 024) ───────────────────────────────────────────
// Every image the app hosts (generated hero, uploaded hero, product photo,
// flyer render, direct library upload) gets a row so it can be browsed and
// reused later without a fresh generation. Distinct from StyleReference:
// a style reference steers HOW a new image looks; a MediaAsset IS a finished
// image someone might reuse as-is.

/** What the image was used for (or is meant for) when it was hosted. */
export type MediaAssetKind = "hero" | "flyer" | "product" | "general";

/** Whether an AI model rendered it, or a human uploaded it as-is. */
export type MediaAssetSource = "generated" | "uploaded";

export interface MediaAsset {
  id: string;
  brand_id: string;
  url: string;
  storage_path: string;
  alt: string | null;
  kind: MediaAssetKind;
  source: MediaAssetSource;
  style: ContentImageStyle | null;
  prompt: string | null;
  width: number | null;
  height: number | null;
  origin_draft_id: string | null;
  created_at: string;
}

// Rolled-up token/image spend for one draft, persisted on drafts.meta so the
// review screen can show "This draft cost ~$0.0X". Estimates for display, not
// billing truth.
export interface DraftUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  images: number;
  estimated_usd: number;
}

export interface StyleEditHistoryEntry {
  html: string;
  instruction: string;
  at: string; // ISO timestamp
  type?: EditType;
}

// Tracks a draft's generation progress so the review page can render a real
// wait state instead of a fake rotator. A draft is a "shell" (empty content)
// while status is "generating"; the draft page swaps in the review UI once
// status is "ready".
export interface DraftGenerationState {
  status: "generating" | "ready" | "error";
  phase: string;
  label: string;
  started_at: string; // ISO timestamp
  error?: string;
}

// ── Blog drafts ──────────────────────────────────────────────────────────────
// A blog draft reuses the drafts table via content_jobs.type='blog'. Its
// `content` column stores the EmailDraftContent SHAPE (subject = title,
// preheader = meta_description, html = the article preview) so every list,
// review-page, and approve-gate code path keeps working unchanged; the real
// structured post lives in meta.blog_copy (section bodies are markdown).

export type ContentJobType = "email" | "blog" | "social";

export interface BlogSection {
  heading: string;
  body: string; // markdown
}

export interface BlogCopy {
  title: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  intro: string; // markdown
  sections: BlogSection[];
  conclusion: string; // markdown
  cta_text: string;
  cta_url?: string;
}

// ── Social flyer drafts ──────────────────────────────────────────────────────
// A flyer draft reuses the drafts table via content_jobs.type='social', the
// same trick blogs use: `content` stores the EmailDraftContent SHAPE
// (subject = headline, preheader = caption excerpt, html = "") so every list,
// review-page, and approve-gate code path keeps working; the real flyer lives
// in meta.flyer_copy / meta.flyer_image.

/** Instagram/Facebook post shapes. Width/height presets live in
 * prompts/generate-flyer.ts (FLYER_ASPECTS). */
export type FlyerAspect = "1:1" | "4:5" | "9:16";

export interface FlyerCopy {
  /** Rendered IN the image, as-is. Keep it short. */
  headline: string;
  /** Rendered IN the image under the headline (optional). */
  subtext?: string;
  /** Rendered IN the image as the call-to-action (optional). */
  cta?: string;
  /** The post caption that accompanies the image; NOT rendered in it. */
  caption: string;
  hashtags?: string[];
}

/** How a reference image is used: "style" borrows the look loosely (the
 * default, the original migration-014 flyer behavior); "recreate" rebuilds the
 * reference's actual layout/composition with our own text and brand. */
export type StyleReferenceMode = "style" | "recreate";

/** What an uploaded reference image is a reference FOR (migration 016):
 * a flyer's visual style, or an email's design to recreate. */
export type StyleReferenceKind = "flyer" | "email";

/** What Claude distilled once, at upload time, from an uploaded email design
 * screenshot (prompts/extract-design.ts). Describes the DESIGN only, never the
 * marketing copy: the copy always comes from this brand's own brief. */
export interface EmailDesignProfile {
  /** One paragraph on the overall look: era, mood, density, visual weight. */
  summary: string;
  /** The sections top to bottom, e.g. "full-width hero image",
   * "two-column product grid", "dark footer bar". */
  layout: string[];
  palette_notes?: string;
  typography_notes?: string;
}

/** One row of style_references (migration 014, extended by 016): an uploaded
 * reference image, either a flyer's visual style or an email design to
 * recreate. kind/mode/design_profile are optional in the type because a
 * pre-016 database simply doesn't return them. */
export interface StyleReference {
  id: string;
  brand_id: string;
  name: string;
  image_url: string;
  storage_path: string;
  notes: string | null;
  created_at: string;
  kind?: StyleReferenceKind;
  mode?: StyleReferenceMode;
  design_profile?: EmailDesignProfile | null;
}

// ── Reference emails (migration 015) ────────────────────────────────────────

/** The style traits Claude distills from one uploaded reference email
 * (prompts/extract-style.ts). Injected into generation instead of re-analyzing
 * the raw email on every draft. */
export interface ReferenceEmailStyleProfile {
  /** 2-3 sentences describing how this email is written. */
  summary: string;
  /** Short imperative style rules generation should follow, e.g.
   * "Open with a one-line hook, no greeting". */
  traits: string[];
  /** Approximate body word count of the reference. */
  approx_words?: number;
}

/** One row of reference_emails: a full email the user provided as "write like
 * this", stored raw plus its distilled style profile. */
export interface ReferenceEmail {
  id: string;
  brand_id: string;
  name: string;
  content: string;
  style_profile: ReferenceEmailStyleProfile | null;
  created_at: string;
}

export interface DraftMeta {
  meta_title?: string;
  meta_description?: string;
  email_template_id?: EmailTemplateId;
  // The visual design direction chosen for this draft (rotation, no
  // consecutive repeats). Set at fresh-generation time from pickEmailStyle;
  // regenerate/redesign REUSE this value (like email_template_id) instead of
  // rotating again, so a locked/edited draft keeps its look. jsonb, no
  // migration needed.
  email_style_variant?: EmailStyleId;
  // The marketing purpose that drove this draft's length budget. Set at
  // generation time from resolveEmailType so the review surface and future
  // logic know which length target the draft was shaped against.
  email_type?: EmailType;
  // The blog format that drove this post's length budget (blog jobs only).
  blog_type?: BlogType;
  email_copy?: EmailCopy;
  // Structured blog post for content_jobs.type='blog' drafts; the source of
  // truth the Sanity publish converts to Portable Text.
  blog_copy?: BlogCopy;
  email_design_source?: "model" | "template";
  // Undo stack for the design-adjustment chat: the html BEFORE each style
  // edit, most-recent last, capped. Lives in meta (jsonb, no migration
  // needed) since style edits update drafts.content in place with no
  // versioning of their own.
  style_edit_history?: StyleEditHistoryEntry[];
  generation?: DraftGenerationState;
  // The AI-generated hero image currently placed in this draft's HTML, if any.
  // Kept in meta so Redesign/regenerate can re-place it and so DELETE can
  // clean up cleanly. jsonb, no migration needed.
  hero_image?: ContentImage;
  // Token/image spend rollup for the cost panel on the review screen.
  usage?: DraftUsage;
  // For a blog draft spun off an email (content_jobs.type='blog' created via
  // /api/drafts/[id]/create-blog): the id of the source email draft, so the
  // Blogs list and the blog review screen can link back to the email it grew
  // out of. Lives in meta (jsonb) on purpose — it survives generation because
  // populateDraft merges meta rather than replacing it, so this needs no
  // migration.
  source_draft_id?: string;
  // Per-email brief for a draft created as part of a multi-email series
  // (plan_series): overrides the shared campaign brief at generation time so
  // each email in the series keeps its own angle/message/offer. Lives in meta
  // (jsonb) and survives generation because populateDraft merges meta.
  series_brief?: CampaignBrief;
  // ── Social flyer fields (content_jobs.type='social' drafts only). All jsonb,
  // no migration needed; they survive generation because populateDraft merges
  // meta rather than replacing it.
  // The structured flyer: in-image text (headline/subtext/cta) + post caption.
  flyer_copy?: FlyerCopy;
  // The rendered flyer currently attached to this draft (hosted on Supabase
  // Storage; prompt field enables tweak-and-regenerate like hero images).
  flyer_image?: ContentImage;
  // The post shape this flyer was rendered at. Defaults to "1:1" when absent.
  flyer_aspect?: FlyerAspect;
  // The visual concept behind the current render (imagery only, no text), so
  // the edit sheet can rebuild the prompt after copy tweaks without a new
  // copy-crafting call.
  flyer_scene?: string;
  // Freeform creative brief typed at creation time (standalone flyers).
  flyer_brief?: string;
  // The style_references row whose image steers this flyer's look, if any.
  style_reference_id?: string;
  // Position of this draft within its plan_series batch, set at shell
  // creation (createDraftShell). Lets the parallel per-draft generation
  // calls assign distinct style/layout by index (rotation.length-cycle),
  // instead of racing a "recent variants" DB read against sibling calls
  // that haven't persisted yet. Absent for non-series drafts, which pick
  // from recent history instead. jsonb, no migration needed.
  series_seed_index?: number;
}

// One row in the Emails / Blogs dashboard lists. source_draft_id and
// source_subject are only set for blog drafts that were spun off an email.
export interface DraftListRow {
  id: string;
  topic_title: string | null;
  subject: string;
  state: string;
  version: number;
  archived: boolean;
  created_at: string;
  job_type: ContentJobType;
  source_draft_id: string | null;
  source_subject: string | null;
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
  archived: boolean;
  created_at: string;
  // Which pipeline made this draft; the review page branches renderer on it.
  job_type: ContentJobType;
  /** Reviewer's thumbs rating (migration 020); fed back into generation. */
  feedback: DraftFeedback | null;
  /** Optional reason alongside the rating (migration 023), a canned chip or
   * free text; fed back into generation as WHY a disliked draft missed. */
  feedback_note: string | null;
}

/** Thumbs rating a reviewer can put on a draft. */
export type DraftFeedback = "up" | "down";

/** One rated past email, distilled for the generation prompt's
 * liked/disliked examples block. */
export interface FeedbackEmailExample {
  feedback: DraftFeedback;
  subject: string;
  email_type: EmailType | null;
  /** Flattened body copy, truncated at query time to keep prompts lean. */
  excerpt: string;
  /** Optional reason the reviewer gave alongside a down rating. */
  note?: string | null;
}

// Minimal context needed by the regeneration pipeline.
export interface DraftJobContext {
  draftId: string;
  jobId: string;
  topicId: string;
  campaignId: string | null;
  version: number;
  content: EmailDraftContent;
  meta: DraftMeta;
  jobType: ContentJobType;
  state: string;
  // content_jobs.email_type/blog_type: null unless set explicitly at shell
  // creation (an override for this job) or backfilled after a prior
  // generation resolved one. Regeneration honors a non-null value instead of
  // re-deriving.
  emailType: EmailType | null;
  blogType: BlogType | null;
}

// One row of the publications table: where a job went and its external id.
export interface PublicationRecord {
  id: string;
  job_id: string;
  target: string;
  external_id: string | null;
  url: string | null;
  published_at: string;
  // 'sent' | 'scheduled' | 'draft' (migration 006). 'draft' means the
  // provider created the resource but a send/schedule call failed or was
  // never attempted (e.g. MailerLite scheduling error) — Sanity/blog rows
  // stay 'sent' since publishing there has no scheduling concept.
  status: string;
  scheduled_for: string | null;
}

// One performance snapshot row (migration-free: the `performance` table has
// existed since schema v1; Plan 2 is the first thing that writes to it).
// metric is a loose text label ("sent" | "opens" | "open_rate" | "clicks" |
// "click_rate" for MailerLite today), not an enum, so a new provider's
// metrics never need a migration.
export interface PerformanceMetric {
  metric: string;
  value: number;
}

// A per-brand publishing connection (MailerLite, Sanity, ...). `config` holds
// the connection's fields: plain values as-is, secret values as the
// "gcm:v1:..." ciphertext from lib/crypto/secrets.ts. One row per
// (brand, provider); env vars remain the fallback when a field is unset here.
export interface BrandIntegration {
  id: string;
  brand_id: string;
  provider_id: string;
  config: Record<string, unknown>;
  connected_at: string;
}

// A recurring auto-generation series (migration 010, improvement plan 6). A
// daily cron picks up rows where active && next_run_at <= now, generates a
// draft for the oldest un-started topic, and leaves it in_review, same
// approval gate as a manually triggered draft. next_run_at only advances
// after an attempt, so a missed tick or a transient failure just retries.
export type Cadence = "daily" | "weekly" | "biweekly" | "monthly";

export interface ContentSchedule {
  id: string;
  brand_id: string;
  channel: ContentJobType;
  cadence: Cadence;
  email_type: EmailType | null;
  blog_type: BlogType | null;
  active: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_result: string | null;
  created_at: string;
}

// ── User roles (migration 013). Flat, not brand-scoped yet — 'admin' can
// see the Logs screen, 'user' can't. See multi-tenancy-roadmap.md for how
// this grows into per-brand roles later.
export type UserRole = "admin" | "user";

// ── Logs: unified real-time feed for errors/warnings/info + Claude token
// usage (migration 011). `level` doubles as severity (info/warn/error) and
// as the usage-row discriminator; usage-only fields are null on log rows and
// vice versa. See lib/log.ts for the write path, lib/db/queries.ts for reads.
export type AppLogLevel = "info" | "warn" | "error" | "usage";

export interface AppLog {
  id: string;
  created_at: string;
  level: AppLogLevel;
  source: string;
  message: string;
  context: Record<string, unknown>;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  estimated_usd: number | null;
  draft_id: string | null;
}

// Prompt capture (migration 021): the exact request body of every AI call,
// written from the HTTP client layer (lib/clients/anthropic.ts custom fetch,
// lib/clients/gemini-image.ts) via lib/log.ts logPrompt. `request` is the
// full sanitized body and can be megabytes, so list reads use PromptLogSummary
// (everything except `request`) and only the /prompts/[id] detail page pulls
// the full row.
export type PromptProvider = "anthropic" | "gemini";

export interface PromptLogSummary {
  id: string;
  created_at: string;
  provider: PromptProvider;
  endpoint: string;
  model: string | null;
  preview: string;
  message_count: number;
  char_count: number;
}

export interface PromptLog extends PromptLogSummary {
  request: Record<string, unknown>;
}

// Billing (migration 019). One row per brand, mirroring Stripe's own state so
// the app never has to call Stripe just to answer "what plan is this brand
// on". Kept in sync by the checkout/webhook routes in lib/billing/stripe.ts.
export type PlanCode = "free" | "pro";

export interface BrandBilling {
  brand_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_code: PlanCode;
  status: string | null;
  current_period_end: string | null;
  updated_at: string;
}
