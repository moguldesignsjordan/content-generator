import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandWithIcps } from "@/lib/db/queries";
import { BrandBasicsForm } from "./_components/brand-basics-form";
import { BrandVoiceForm } from "./_components/brand-voice-form";
import { FunnelForm } from "./_components/funnel-form";
import { IcpForm } from "./_components/icp-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const data = await getBrandWithIcps();
  if (!data) notFound();

  const { brand, strategy, icps } = data;
  const primaryIcp = icps.find((i) => i.is_primary) ?? icps[0] ?? null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Back to topics
      </Link>

      <header className="mt-4 mb-10">
        <p className="text-sm text-muted">Brand Settings</p>
        <h1 className="mt-1 text-2xl font-semibold">{brand.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Changes here take effect on the next generation.
        </p>
      </header>

      <div className="space-y-12">
        <section>
          <h2 className="mb-1 text-lg font-medium">Brand Basics</h2>
          <p className="mb-4 text-sm text-muted">
            Brand name, email sender identity, and SEO geography.
          </p>
          <BrandBasicsForm
            brandId={brand.id}
            name={brand.name}
            mailerliteConfig={brand.mailerlite_config}
            seoDefaults={brand.seo_defaults}
          />
        </section>

        <section>
          <h2 className="mb-1 text-lg font-medium">Brand Voice</h2>
          <p className="mb-4 text-sm text-muted">
            The personality and guardrails injected into every generation prompt.
            Example posts are the single biggest quality lever — add real ones you&apos;ve written.
          </p>
          <BrandVoiceForm brandId={brand.id} voiceProfile={brand.voice_profile} />
        </section>

        {strategy && (
          <section>
            <h2 className="mb-1 text-lg font-medium">Funnel Configuration</h2>
            <p className="mb-4 text-sm text-muted">
              Maps each funnel stage to a CTA type. Keys must match entries in your CTA Library above.
            </p>
            <FunnelForm
              strategyId={strategy.id}
              funnelDefinition={strategy.funnel_definition}
            />
          </section>
        )}

        {primaryIcp && (
          <section>
            <h2 className="mb-1 text-lg font-medium">Primary ICP</h2>
            <p className="mb-4 text-sm text-muted">
              Who you&apos;re writing for. The more specific and evidence-based these are
              (from real customer calls, not guesses), the sharper the copy.
            </p>
            <IcpForm icp={primaryIcp} />
          </section>
        )}
      </div>
    </main>
  );
}
