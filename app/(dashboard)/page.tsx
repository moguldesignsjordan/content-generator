import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandStrategy } from "@/lib/db/queries";
import type { FunnelStage, TopicStatus } from "@/lib/db/types";
import { GenerateButton } from "./_components/generate-button";

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

  const { brand, pillars } = data;
  const topicCount = pillars.reduce(
    (n, p) => n + p.clusters.reduce((m, c) => m + c.topics.length, 0),
    0,
  );

  return (
    <Shell>
      <header className="mb-8">
        <p className="text-sm text-muted">Content Engine · Slice 0</p>
        <h1 className="mt-1 text-2xl font-semibold">{brand.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {pillars.length} pillars · {topicCount} topics in the strategy
        </p>
      </header>

      <div className="space-y-8">
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
                <div
                  key={cluster.id}
                  className="rounded-lg border border-border bg-surface"
                >
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted">
                      Hub
                    </p>
                    <p className="font-medium">{cluster.hub_title}</p>
                    {cluster.hub_keyword && (
                      <p className="mt-0.5 text-xs text-muted">
                        target: <code>{cluster.hub_keyword}</code>
                      </p>
                    )}
                  </div>
                  <ul>
                    {cluster.topics.map((topic) => (
                      <li
                        key={topic.id}
                        className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm">{topic.title}</p>
                          {topic.target_keyword && (
                            <p className="mt-0.5 truncate text-xs text-muted">
                              <code>{topic.target_keyword}</code>
                              {topic.intent ? ` · ${topic.intent}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {topic.funnel_stage && (
                            <FunnelBadge stage={topic.funnel_stage} />
                          )}
                          <StatusBadge status={topic.status} />
                          <GenerateButton topicId={topic.id} />
                        </div>
                      </li>
                    ))}
                    {cluster.topics.length === 0 && (
                      <li className="px-4 py-3 text-sm text-muted">
                        No spoke topics yet.
                      </li>
                    )}
                  </ul>
                </div>
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

const STATUS_STYLES: Record<TopicStatus, string> = {
  idea: "bg-border text-muted",
  queued: "bg-accent/20 text-accent",
  in_progress: "bg-amber-500/20 text-amber-300",
  published: "bg-emerald-500/20 text-emerald-300",
};

function StatusBadge({ status }: { status: TopicStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function FunnelBadge({ stage }: { stage: FunnelStage }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
      {stage}
    </span>
  );
}
