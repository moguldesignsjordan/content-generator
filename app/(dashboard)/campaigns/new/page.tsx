import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSessionUser } from "@/lib/supabase/server";
import { getBrandWithIcps, listProducts, listTopics } from "@/lib/db/queries";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../../_components/screen-header";
import { CampaignForm } from "./_components/campaign-form";

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

  const [products, topics] = await Promise.all([
    listProducts(data.brand.id).catch(() => []),
    listTopics().catch(() => []),
  ]);

  return (
    <>
      <ScreenHeader
        title="New campaign"
        subtitle="Pick what you're making, answer a few quick questions, and get a designed draft."
      />
      <CampaignForm
        products={products.map((p) => ({ slug: p.slug, name: p.name }))}
        topics={topics.map((t) => ({ id: t.id, title: t.title, pillar: t.pillar }))}
      />
    </>
  );
}
