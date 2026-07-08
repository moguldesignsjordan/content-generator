import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandWithIcps, getCampaignPublishProgress, listCampaigns } from "@/lib/db/queries";
import type { CampaignSummary } from "@/lib/db/types";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { CampaignsList } from "../_components/campaigns-list";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to load your campaigns.
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

  let campaigns: CampaignSummary[];
  try {
    const rows = await listCampaigns(data.brand.id);
    const progress = await getCampaignPublishProgress(rows.map((c) => c.id));
    campaigns = rows.map((c) => ({
      ...c,
      ...(progress.get(c.id) ?? { emails: 0, sent: 0, scheduled: 0 }),
    }));
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Couldn't load campaigns</h1>
        <p className="mt-2 text-sm text-muted">
          {err instanceof Error ? err.message : "Try again in a moment."}
        </p>
      </Card>
    );
  }

  return (
    <>
      <ScreenHeader
        title="Campaigns"
        subtitle="Every campaign, newest first. Open one to jump into its emails."
        actions={
          <LinkButton href="/campaigns/new" variant="gradient" size="sm">
            New campaign
          </LinkButton>
        }
      />
      <CampaignsList campaigns={campaigns} />
    </>
  );
}
