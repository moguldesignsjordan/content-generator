import { notFound, redirect } from "next/navigation";
import { getBrandWithIcps, getCampaign, getDraftStatuses } from "@/lib/db/queries";
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
  const statuses = await getDraftStatuses(data.brand.id, draftIds).catch(() => ({}));

  return <CampaignView campaignId={campaign.id} initial={factory} statuses={statuses} />;
}
