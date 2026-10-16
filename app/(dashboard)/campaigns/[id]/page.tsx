import { notFound, redirect } from "next/navigation";
import { getBrandWithIcps, getCampaign, getDraftStatuses, listProducts } from "@/lib/db/queries";
import { unsavedPlanProducts } from "@/lib/factory/plan";
import { getSessionUser } from "@/lib/supabase/server";
import { CampaignView } from "./_components/campaign-view";

export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [data, campaign] = await Promise.all([
    getBrandWithIcps(user.id).catch(() => null),
    getCampaign(id).catch(() => null),
  ]);
  if (!data || !campaign || campaign.brand_id !== data.brand.id) notFound();
  // Chat campaigns have no page of their own; their drafts live in the lists.
  const factory = campaign.chat_state?.factory;
  if (!factory) redirect("/campaigns");

  const draftIds = (factory.plan ?? [])
    .map((i) => i.draft_id)
    .filter((d): d is string => Boolean(d));
  const [statuses, products] = await Promise.all([
    getDraftStatuses(data.brand.id, draftIds).catch(() => ({})),
    factory.products?.length ? listProducts(data.brand.id).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <CampaignView
      campaignId={campaign.id}
      initial={factory}
      statuses={statuses}
      brandId={data.brand.id}
      unsavedProducts={factory.products?.length ? unsavedPlanProducts(factory, products) : []}
    />
  );
}
