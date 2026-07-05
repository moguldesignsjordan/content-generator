import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandWithIcps, listProducts } from "@/lib/db/queries";
import { listProviders } from "@/lib/publishing/registry";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { SettingsClient } from "./_components/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to manage your brand.
        </p>
      </Card>
    );
  }

  let data: Awaited<ReturnType<typeof getBrandWithIcps>>;
  try {
    data = await getBrandWithIcps();
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn't load settings
        </h1>
        <p className="mt-2 text-sm text-muted">
          {err instanceof Error ? err.message : "Try again in a moment."}
        </p>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="p-7 text-center">
        <h1 className="font-display text-xl font-semibold">No brand yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Run onboarding to build your brand profile, then fine-tune it here.
        </p>
        <LinkButton href="/onboarding" variant="gradient" className="mt-5">
          Start onboarding
        </LinkButton>
      </Card>
    );
  }

  const { brand, strategy, icps } = data;
  const primaryIcp = icps.find((i) => i.is_primary) ?? icps[0] ?? null;
  const products = await listProducts(brand.id);

  return (
    <>
      <ScreenHeader
        title="Settings"
        subtitle={`${brand.name} · changes take effect on the next generation`}
      />
      <SettingsClient
        brand={brand}
        strategy={strategy}
        primaryIcp={primaryIcp}
        products={products}
        connections={listProviders().map((p) => ({
          id: p.id,
          label: p.label,
          kind: p.kind,
          configured: p.isConfigured(),
          configHint: p.configHint,
        }))}
      />
    </>
  );
}
