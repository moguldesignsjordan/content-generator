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
import type { FactoryPlanItem, FactoryState } from "@/lib/db/types";
import { loadOwnFactoryCampaign } from "@/lib/factory/access";
import { buildFlyerBriefText, buildPieceBrief } from "@/lib/factory/brief";
import { pickTestItems } from "@/lib/factory/plan";
import { loadUnitCosts, quotePlan } from "@/lib/pipeline/campaign-factory";
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

    const launched = new Map<string, string>();
    for (const item of chosen) {
      const product = item.offer_slug
        ? products.find((p) => p.slug === item.offer_slug)
        : undefined;
      // The photo the owner attached wins; otherwise the promoted product's own.
      const photoUrl = factory.photo_url ?? product?.image_url ?? undefined;
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
        photoUrl,
        plan,
        factory,
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

function createShell(
  item: FactoryPlanItem,
  args: {
    ctx: NonNullable<Awaited<ReturnType<typeof getTopicContext>>>;
    campaignId: string;
    photoUrl?: string;
    plan: FactoryPlanItem[];
    factory: FactoryState;
  },
): Promise<string> {
  const format = getCampaignFormat(item.format);
  const common = { ctx: args.ctx, campaignId: args.campaignId };
  if (item.kind === "email" || item.kind === "blog") {
    return createDraftShell({
      ...common,
      type: item.kind,
      ...(format?.emailType ? { emailType: format.emailType } : {}),
      ...(format?.blogType ? { blogType: format.blogType } : {}),
      seriesBrief: buildPieceBrief(item, args.factory, args.photoUrl),
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
    flyerBrief: buildFlyerBriefText(item, args.factory.sentence, args.factory.research),
    ...(args.photoUrl ? { productPhotoUrl: args.photoUrl } : {}),
    ...(args.factory.look_id ? { lookId: args.factory.look_id } : {}),
    ...(args.factory.reference_urls?.length ? { referenceUrls: args.factory.reference_urls } : {}),
    ...(args.factory.reference_profile ? { referenceProfile: args.factory.reference_profile } : {}),
    ...(args.factory.client_brand ? { clientBrand: args.factory.client_brand } : {}),
    // Organic posts go out on their day through the daily cron once approved.
    // Ads never get a posting date: that cron would publish them as organic
    // posts. They're run from Ads Manager instead.
    ...(item.kind === "social" ? { plannedPublishAt: item.date } : {}),
  });
}
