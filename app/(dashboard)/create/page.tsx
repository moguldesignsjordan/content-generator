import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandStrategy } from "@/lib/db/queries";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { FunnelBadge } from "../_components/topic-badges";
import { ClusterCard } from "../_components/cluster-card";
import { QuickGenerate } from "../_components/quick-generate";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to load your topics.
        </p>
      </Card>
    );
  }

  let data: Awaited<ReturnType<typeof getBrandStrategy>>;
  try {
    data = await getBrandStrategy();
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn't reach the database
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
          Build your brand profile first, then generate from your topics.
        </p>
        <LinkButton href="/onboarding" variant="gradient" className="mt-5">
          Start onboarding
        </LinkButton>
      </Card>
    );
  }

  const { pillars, latestDraftByTopic } = data;
  const allTopics = pillars.flatMap((p) =>
    p.clusters.flatMap((c) =>
      c.topics.map((t) => ({ id: t.id, title: t.title, pillarName: p.name })),
    ),
  );

  return (
    <>
      <ScreenHeader
        title="Create"
        subtitle="Pick a topic to draft, or browse your strategy tree."
      />

      <div className="mb-9">
        <QuickGenerate topics={allTopics} />
      </div>

      <div className="space-y-9">
        {pillars.map((pillar) => (
          <section key={pillar.id}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-display text-[18px] font-semibold tracking-tight text-foreground">
                {pillar.name}
              </h2>
              <FunnelBadge stage={pillar.primary_funnel_stage} />
            </div>
            {pillar.description && (
              <p className="mb-4 max-w-2xl text-[14px] leading-relaxed text-muted">
                {pillar.description}
              </p>
            )}
            <div className="space-y-4">
              {pillar.clusters.map((cluster) => (
                <ClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  latestDraftByTopic={latestDraftByTopic}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
