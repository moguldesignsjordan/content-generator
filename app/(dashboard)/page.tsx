import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandStrategy } from "@/lib/db/queries";
import { ClusterCard } from "./_components/cluster-card";
import { FunnelBadge } from "./_components/topic-badges";
import { QuickGenerate } from "./_components/quick-generate";

// Always read fresh from the DB in dev; topics change as you work.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell>
        <SetupNotice
          title="Connect Supabase to continue"
          steps={[
            "Create a Supabase project (Project Settings → API).",
            "Paste the project URL, anon key, and service-role key into .env.local.",
            "Run the schema: paste db/schema.sql into the Supabase SQL editor.",
            "Seed the brand: npm run seed",
            "Reload this page — your topics will appear here.",
          ]}
        />
      </Shell>
    );
  }

  let data: Awaited<ReturnType<typeof getBrandStrategy>>;
  try {
    data = await getBrandStrategy();
  } catch (err) {
    return (
      <Shell>
        <SetupNotice
          title="Couldn't reach the database"
          steps={[
            "Confirm db/schema.sql has been applied in Supabase.",
            "Check the three SUPABASE_* values in .env.local.",
            String(err instanceof Error ? err.message : err),
          ]}
        />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <SetupNotice
          title="No brand seeded yet"
          steps={[
            "Apply db/schema.sql in the Supabase SQL editor.",
            "Run: npm run seed",
            "Reload this page.",
          ]}
        />
      </Shell>
    );
  }

  const { brand, pillars, latestDraftByTopic } = data;
  const topicCount = pillars.reduce(
    (n, p) => n + p.clusters.reduce((m, c) => m + c.topics.length, 0),
    0,
  );

  // Flatten all topics for the quick-generate dropdown.
  const allTopics = pillars.flatMap((p) =>
    p.clusters.flatMap((c) =>
      c.topics.map((t) => ({ id: t.id, title: t.title, pillarName: p.name })),
    ),
  );

  return (
    <Shell>
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Content Engine</p>
            <h1 className="mt-1 text-2xl font-semibold">{brand.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {pillars.length} pillars · {topicCount} topics
            </p>
          </div>
          <Link
            href="/settings"
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:text-foreground"
          >
            Settings
          </Link>
        </div>
      </header>

      {/* Primary action */}
      <div className="mb-10">
        <QuickGenerate topics={allTopics} />
      </div>

      {/* Strategy reference */}
      <div className="space-y-8">
        <p className="text-xs uppercase tracking-wide text-muted">Strategy</p>
        {pillars.map((pillar) => (
          <section key={pillar.id}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-medium">{pillar.name}</h2>
              <FunnelBadge stage={pillar.primary_funnel_stage} />
            </div>
            {pillar.description && (
              <p className="mb-3 max-w-2xl text-sm text-muted">
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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
  );
}

function SetupNotice({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <ol className="mt-4 space-y-2 text-sm text-muted">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="text-accent">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

