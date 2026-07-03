import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandWithIcps } from "@/lib/db/queries";
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

  const data = await getBrandWithIcps();
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

  return (
    <>
      <ScreenHeader
        title="New campaign"
        subtitle="A quick strategy conversation, then a designed draft to review."
      />
      <CampaignChat />
    </>
  );
}
