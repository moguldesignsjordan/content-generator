import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getBrandStrategy, listDrafts } from "@/lib/db/queries";
import {
  Card,
  LinkButton,
  ListGroup,
  ListRow,
  StatCard,
} from "@/components/ui";
import { ChevronRightIcon, SparkleIcon } from "@/components/ui/icons";
import { Assistant } from "./_components/assistant";
import { ScreenHeader } from "./_components/screen-header";
import { DraftStateBadge } from "./_components/topic-badges";

// Always read fresh from the DB; topics/drafts change as you work.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <SetupNotice
        title="Connect Supabase to continue"
        steps={[
          "Create a Supabase project (Project Settings, API).",
          "Paste the project URL, anon key, and service-role key into .env.local.",
          "Run the schema: paste db/schema.sql into the Supabase SQL editor.",
          "Seed the brand: npm run seed",
          "Reload this page, your topics will appear here.",
        ]}
      />
    );
  }

  let data: Awaited<ReturnType<typeof getBrandStrategy>>;
  try {
    data = await getBrandStrategy();
  } catch (err) {
    return (
      <SetupNotice
        title="Couldn't reach the database"
        steps={[
          "Confirm db/schema.sql has been applied in Supabase.",
          "Check the three SUPABASE_* values in .env.local.",
          String(err instanceof Error ? err.message : err),
        ]}
      />
    );
  }

  if (!data) {
    return (
      <Card className="p-7 text-center">
        <h1 className="font-display text-xl font-semibold">No brand yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Build your brand profile to start generating on-brand content.
        </p>
        <LinkButton href="/onboarding" variant="gradient" className="mt-5">
          Start onboarding
        </LinkButton>
      </Card>
    );
  }

  const { brand, pillars } = data;
  const drafts = await listDrafts().catch(() => []);
  const allTopics = pillars.flatMap((p) =>
    p.clusters.flatMap((c) =>
      c.topics.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    ),
  );

  const inReview = drafts.filter((d) => d.state === "in_review").length;
  const approved = drafts.filter((d) => d.state === "approved").length;
  const queued = allTopics.filter((t) => t.status === "queued").length;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const suggestions = allTopics.slice(0, 3).map((t) => ({
    label: t.title.length > 30 ? `${t.title.slice(0, 30)}…` : t.title,
    text: `Draft an email for "${t.title}"`,
  }));

  return (
    <div className="space-y-8">
      {brand.onboarding_state?.completed !== true && <FinishSetupBanner />}

      <ScreenHeader
        title={greeting}
        subtitle={`${brand.name} · content engine`}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2.5">
        <StatCard label="In review" value={inReview} sub="drafts" />
        <StatCard label="Approved" value={approved} sub="ready to ship" />
        <StatCard label="Topics" value={allTopics.length} sub={`${queued} queued`} />
      </div>

      {/* Assistant — the main tool */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <SparkleIcon size={16} className="text-accent" />
          <h2 className="text-[15px] font-semibold text-foreground">
            Content assistant
          </h2>
        </div>
        <Assistant suggestions={suggestions} />
      </section>

      {/* Recent emails */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">
            Recent emails
          </h2>
          {drafts.length > 0 && (
            <Link
              href="/emails"
              className="flex items-center gap-0.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-press"
            >
              View all
              <ChevronRightIcon size={14} />
            </Link>
          )}
        </div>

        {drafts.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">
            No emails yet. Ask the assistant to draft one.
          </Card>
        ) : (
          <ListGroup>
            {drafts.slice(0, 5).map((d) => (
              <ListRow
                key={d.id}
                href={`/drafts/${d.id}`}
                title={d.subject || "Untitled draft"}
                subtitle={d.topic_title ?? "No topic"}
                trailing={<DraftStateBadge state={d.state} />}
              />
            ))}
          </ListGroup>
        )}
      </section>
    </div>
  );
}

function FinishSetupBanner() {
  return (
    <Link
      href="/onboarding"
      className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-accent/25 bg-accent/[0.07] px-4 py-3 transition-colors hover:bg-accent/[0.12]"
    >
      <span className="text-[14px]">
        <span className="font-medium text-foreground">
          Finish setting up your brand.
        </span>{" "}
        <span className="text-muted">
          Chat with the strategist to build your brand brain.
        </span>
      </span>
      <span className="shrink-0 text-[13px] font-medium text-accent">Start →</span>
    </Link>
  );
}

function SetupNotice({ title, steps }: { title: string; steps: string[] }) {
  return (
    <Card className="p-7">
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      <ol className="mt-4 space-y-2.5 text-sm text-muted">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="text-accent">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
