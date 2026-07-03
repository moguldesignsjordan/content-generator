import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandStrategy } from "@/lib/db/queries";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { FunnelBadge } from "../_components/topic-badges";
import { ClusterCard } from "../_components/cluster-card";
import { QuickGenerate } from "../_components/quick-generate";
import { SuggestTopics } from "../_components/suggest-topics";

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

  const hasTopics = allTopics.length > 0;

  return (
    <>
      <ScreenHeader
        title="Create"
        subtitle="Tell it what you want to send, or pick from your content plan."
      />

      {/* Hero: the campaign conversation is the main way to create. */}
      <Card className="mb-6 flex flex-col items-start justify-between gap-4 p-7 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-[19px] font-semibold text-foreground">
            What do you want to send?
          </h2>
          <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-muted">
            A short conversation about the goal, the audience, and the message.
            Then your email is drafted from your brand brain.
          </p>
        </div>
        <LinkButton href="/campaigns/new" variant="gradient">
          Start a campaign
        </LinkButton>
      </Card>

      {hasTopics && (
        <div className="mb-9">
          <QuickGenerate topics={allTopics} />
        </div>
      )}

      {/* Content plan: the topic backlog. Secondary to the campaign flow. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-[18px] font-semibold tracking-tight text-foreground">
          Content plan
        </h2>
        {hasTopics && <SuggestTopics compact />}
      </div>

      {hasTopics ? (
        <div className="space-y-9">
          {pillars.map((pillar) => (
            <section key={pillar.id}>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="font-display text-[16px] font-semibold tracking-tight text-foreground">
                  {pillar.name}
                </h3>
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
      ) : (
        <Card className="p-7 text-center">
          <h3 className="font-display text-[16px] font-semibold text-foreground">
            No topics yet
          </h3>
          <p className="mx-auto mt-2 mb-5 max-w-sm text-sm text-muted">
            Your content plan is the backlog of email ideas. Get a starter set
            suggested from your brand profile, or create topics naturally
            through campaigns.
          </p>
          <SuggestTopics />
        </Card>
      )}
    </>
  );
}
