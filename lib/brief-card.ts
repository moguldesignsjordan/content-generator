import type {
  Brand,
  CampaignBrief,
  FunnelStage,
  Icp,
  Product,
  Strategy,
} from "@/lib/db/types";

/**
 * The display projection of a campaign brief rendered as editable rows in the
 * create-agent UI. Shared by the chat route (built fresh each turn) and the
 * dashboard page (built once on load, from the resumed campaign) so reloading
 * mid-brief shows the same card instead of a blank one until the next message.
 */
export interface CreateBriefCard {
  topicTitle: string | null;
  audience: string | null;
  goal: string | null;
  keyMessage: string | null;
  angle: string | null;
  offerName: string | null;
  offerPrice: string | null;
  funnelStage: FunnelStage | null;
  ctaLabel: string | null;
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

  return {
    topicTitle,
    audience: brief.audience_notes ?? primaryIcp?.label ?? null,
    goal: brief.goal ?? null,
    keyMessage: brief.key_message ?? null,
    angle: brief.angle ?? null,
    offerName: offer?.name ?? null,
    offerPrice: offer?.price_point ?? null,
    funnelStage,
    ctaLabel: resolveCtaLabel(brand, strategy, funnelStage),
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
