import type {
  Brand,
  CampaignBrief,
  FunnelStage,
  Icp,
  Product,
  Strategy,
  VisualVibe,
} from "@/lib/db/types";

/**
 * The display projection of a campaign brief rendered as editable rows in the
 * create-agent UI. Shared by the chat route (built fresh each turn) and the
 * dashboard page (built once on load, from the resumed campaign) so reloading
 * mid-brief shows the same card instead of a blank one until the next message.
 */
export interface CreateBriefCard {
  topicTitle: string | null;
  /** User-approved email name (subject line); generation uses it verbatim. */
  subjectLine: string | null;
  /** User-approved subheader (inbox preview text under the subject). */
  preheader: string | null;
  audience: string | null;
  goal: string | null;
  keyMessage: string | null;
  proof: string | null;
  hook: string | null;
  angle: string | null;
  readerBelief: string | null;
  offerName: string | null;
  offerPrice: string | null;
  /** Deal/deadline/exclusions from the brief's own offer_* fields, joined for
   * display (distinct from offerPrice, which is the product row's own). */
  offerSummary: string | null;
  tone: string | null;
  funnelStage: FunnelStage | null;
  ctaLabel: string | null;
  visualVibe: VisualVibe | null;
  hasProductPhoto: boolean;
  /** How many attached photos (brief.photo_urls) will be placed in the email. */
  photoCount: number;
}

/**
 * Resolves a funnel stage to its CTA label (funnel_stage -> strategy cta_type
 * -> brand cta_library), mirroring prompts/generate-email.ts resolveCta
 * without needing a full TopicContext.
 */
export function resolveCtaLabel(
  brand: Brand,
  strategy: Strategy | null,
  stage: FunnelStage | null,
): string | null {
  if (!stage) return null;
  const ctaType = strategy?.funnel_definition?.[stage]?.cta_type ?? null;
  if (!ctaType) return null;
  return brand.voice_profile?.cta_library?.[ctaType] ?? null;
}

export function buildBriefCard(args: {
  brand: Brand;
  strategy: Strategy | null;
  primaryIcp: Icp | null;
  products: Product[];
  brief: CampaignBrief;
  topicTitle: string | null;
  funnelStage: FunnelStage | null;
}): CreateBriefCard {
  const { brand, strategy, primaryIcp, products, brief, topicTitle, funnelStage } = args;
  const offer = brief.offer_slug
    ? (products.find((p) => p.slug === brief.offer_slug) ?? null)
    : null;
  const offerSummary =
    [brief.offer_deal, brief.offer_deadline, brief.offer_exclusions]
      .filter(Boolean)
      .join(" · ") || null;

  return {
    topicTitle,
    subjectLine: brief.subject_line ?? null,
    preheader: brief.preheader ?? null,
    audience: brief.audience_notes ?? primaryIcp?.label ?? null,
    goal: brief.goal ?? null,
    keyMessage: brief.key_message ?? null,
    proof: brief.proof ?? null,
    hook: brief.hook ?? null,
    angle: brief.angle ?? null,
    readerBelief: brief.reader_belief ?? null,
    offerName: offer?.name ?? null,
    offerPrice: brief.offer_price ?? offer?.price_point ?? null,
    offerSummary,
    tone: brief.tone ?? null,
    funnelStage,
    ctaLabel: resolveCtaLabel(brand, strategy, funnelStage),
    visualVibe: brief.visual_vibe ?? null,
    hasProductPhoto: Boolean(brief.product_photo_url),
    photoCount: brief.photo_urls?.length ?? 0,
  };
}

/** Resolves a topic's title + funnel stage from the catalog (for the card). */
export function topicContextFor(
  topicId: string | null,
  topics: { id: string; title: string; funnel_stage: string | null }[],
): { topicTitle: string | null; funnelStage: FunnelStage | null } {
  if (!topicId) return { topicTitle: null, funnelStage: null };
  const found = topics.find((t) => t.id === topicId);
  if (!found) return { topicTitle: null, funnelStage: null };
  return {
    topicTitle: found.title,
    funnelStage: (found.funnel_stage as FunnelStage) ?? null,
  };
}
