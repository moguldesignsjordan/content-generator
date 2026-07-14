import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSessionUser } from "@/lib/supabase/server";
import { getBrandWithIcps, getLatestActiveCampaign } from "@/lib/db/queries";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../../_components/screen-header";
import { CampaignChat } from "./_components/campaign-chat";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to start a campaign.
        </p>
      </Card>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await getBrandWithIcps(user.id);
  if (!data) {
    return (
      <Card className="p-7 text-center">
        <h1 className="font-display text-xl font-semibold">No brand yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Build your brand profile first, then start campaigns from it.
        </p>
        <LinkButton href="/onboarding" variant="gradient" className="mt-5">
          Start onboarding
        </LinkButton>
      </Card>
    );
  }

  // Resume the thread on a hard refresh instead of losing it, but only when
  // there's an actual conversation to resume (mirrors the dashboard's
  // create-agent hydration in app/(dashboard)/page.tsx).
  const activeCampaign = await getLatestActiveCampaign(data.brand.id).catch(
    () => null,
  );
  const activeMessages = activeCampaign?.chat_state?.messages ?? [];
  const initial =
    activeCampaign && activeMessages.length > 0
      ? {
          campaignId: activeCampaign.id,
          messages: activeMessages,
          topicId: activeCampaign.topic_id,
          brief: activeCampaign.brief,
          readyToGenerate: !!(
            activeCampaign.brief.goal &&
            activeCampaign.brief.key_message &&
            activeCampaign.topic_id
          ),
        }
      : undefined;

  return (
    <>
      <ScreenHeader
        title="New campaign"
        subtitle="A quick strategy conversation, then a designed draft to review."
      />
      <CampaignChat initial={initial} />
    </>
  );
}
