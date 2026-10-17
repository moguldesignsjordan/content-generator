import { NextRequest, NextResponse } from "next/server";
import { guardAiRoute } from "@/lib/ai-guard";
import {
  createDraftShell,
  createTopic,
  ensureDefaultCluster,
  ensureStrategyAndPrimaryIcp,
  getTopicContext,
  listProducts,
  updateCampaign,
} from "@/lib/db/queries";
import type { FactoryPlanItem, FactoryState, PieceInputs } from "@/lib/db/types";
import { inputsOf } from "@/lib/inputs";
import { loadOwnFactoryCampaign } from "@/lib/factory/access";
import { buildFlyerBriefText, buildPieceBrief, type PieceProduct } from "@/lib/factory/brief";
import { pickTestItems } from "@/lib/factory/plan";
import { CAMPAIGN_FLYER_OPTIONS, loadUnitCosts, quotePlan } from "@/lib/pipeline/campaign-factory";
import { getCampaignFormat } from "@/prompts/campaign-formats";
import { logError } from "@/lib/log";

/**
 * POST { mode: "test" | "all" }: creates a draft shell for each chosen plan
 * row (no AI here; the campaign page then generates them a few at a time over
 * the normal generate-stream route, which meters and guards each one).
 * "test" is one piece of up to three kinds; "all" is every row not yet made.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const owned = await loadOwnFactoryCampaign(id);
    if (owned instanceof NextResponse) return owned;
    const { campaign, brandId } = owned;
    const factory = campaign.chat_state.factory!;
    const plan = factory.plan ?? [];

    // The credit check up front, so an empty balance stops the batch before
    // any shells exist; each piece is guarded again when it starts generating.
    const guard = await guardAiRoute("factory-launch", { brandId, limit: 6 });
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.error, outOfCredits: guard.outOfCredits ?? false },
        { status: guard.status },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
    const chosen = body.mode === "test" ? pickTestItems(plan) : plan.filter((i) => !i.draft_id);
    if (!chosen.length) {
      return NextResponse.json({ error: "Everything in this plan is already made." }, { status: 400 });
    }

    const { strategy } = await ensureStrategyAndPrimaryIcp(brandId);
    const clusterId = await ensureDefaultCluster(strategy.id);
    const products = await listProducts(brandId).catch(() => []);

    const campaignInputs = inputsOf(factory);
    const launched = new Map<string, string>();
    for (const item of chosen) {
      // A product saved after planning (by name) still brings its details.
      const product = item.offer_slug
        ? products.find((p) => p.slug === item.offer_slug)
        : item.product
          ? products.find((p) => p.name.trim().toLowerCase() === item.product!.trim().toLowerCase())
          : undefined;
      const topic = await createTopic(clusterId, {
        title: item.title,
        target_keyword: "",
        intent: "",
        funnel_stage: "",
        maps_to_product: item.offer_slug ?? "",
      });
      const ctx = await getTopicContext(topic.id);
      if (!ctx) continue;
      const draftId = await createShell(item, {
        ctx,
        campaignId: campaign.id,
        inputs: pieceInputs(item, campaignInputs, product?.image_url ?? undefined),
        plan,
        factory,
        ...(item.product ? { product: product ?? { name: item.product } } : {}),
      });
      launched.set(item.id, draftId);
    }

    const nextPlan = plan.map((item) =>
      launched.has(item.id) ? { ...item, draft_id: launched.get(item.id) } : item,
    );
    const quote = await quotePlan(nextPlan, await loadUnitCosts(brandId));
    await updateCampaign(campaign.id, {
      status: "generating",
      chat_state: { ...campaign.chat_state, factory: { ...factory, plan: nextPlan, quote } },
    });
    return NextResponse.json({ plan: nextPlan, quote, created: launched.size });
  } catch (err) {
    logError("api:/api/factory/[id]/launch", err);
    return NextResponse.json({ error: "Couldn't start generating. Try again." }, { status: 500 });
  }
}

/**
 * One piece's inputs: the photos the planner matched to it (else the
 * campaign's first photo, else the promoted product's own; a one-per-product
 * piece skips the campaign's photo, which may show another product), the
 * campaign's style, and its competitor ads only when the planner chose this
 * piece to follow them.
 */
function pieceInputs(item: FactoryPlanItem, campaign: PieceInputs, productPhoto?: string): PieceInputs {
  const photos = item.photos?.length
    ? item.photos
    : campaign.photos?.length && !item.product
      ? [campaign.photos[0]]
      : productPhoto
        ? [productPhoto]
        : [];
  return {
    ...(photos.length ? { photos } : {}),
    ...(campaign.style_images ? { style_images: campaign.style_images } : {}),
    ...(campaign.style ? { style: campaign.style } : {}),
    ...(item.uses_reference && campaign.competitor_reference_ids?.length
      ? { competitor_reference_ids: campaign.competitor_reference_ids }
      : {}),
  };
}

function createShell(
  item: FactoryPlanItem,
  args: {
    ctx: NonNullable<Awaited<ReturnType<typeof getTopicContext>>>;
    campaignId: string;
    inputs: PieceInputs;
    plan: FactoryPlanItem[];
    factory: FactoryState;
    /** The one product a one-per-product piece is about. */
    product?: PieceProduct;
  },
): Promise<string> {
  const format = getCampaignFormat(item.format);
  const common = { ctx: args.ctx, campaignId: args.campaignId, inputs: args.inputs };
  if (item.kind === "email" || item.kind === "blog") {
    return createDraftShell({
      ...common,
      type: item.kind,
      ...(format?.emailType ? { emailType: format.emailType } : {}),
      ...(format?.blogType ? { blogType: format.blogType } : {}),
      seriesBrief: buildPieceBrief(item, args.factory, args.product),
      // Distinct email styles across the batch, by position in the plan.
      seriesSeedIndex: args.plan.findIndex((p) => p.id === item.id),
    });
  }
  return createDraftShell({
    ...common,
    type: "social",
    flyerFormat: item.kind === "ad" ? "ad" : "post",
    // 4:5 is the tallest size both feeds take; ads run square.
    flyerAspect: item.kind === "ad" ? "1:1" : "4:5",
    flyerBrief: buildFlyerBriefText(item, args.factory.sentence, args.factory.research, args.product),
    ...(args.factory.flyer_style ? { flyerStyle: args.factory.flyer_style } : {}),
    flyerVariantCount: CAMPAIGN_FLYER_OPTIONS,
    ...(args.factory.reference_profile ? { referenceProfile: args.factory.reference_profile } : {}),
    ...(args.factory.client_brand ? { clientBrand: args.factory.client_brand } : {}),
    // withPickedColors reads the scheme off the brief on every render path.
    ...(args.factory.colors?.length ? { seriesBrief: { colors: args.factory.colors } } : {}),
    // Organic posts go out on their day through the daily cron once approved.
    // Ads never get a posting date: that cron would publish them as organic
    // posts. They're run from Ads Manager instead.
    ...(item.kind === "social" ? { plannedPublishAt: item.date } : {}),
  });
}
