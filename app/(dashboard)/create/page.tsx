import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSessionUser } from "@/lib/supabase/server";
import { getBrandStrategy } from "@/lib/db/queries";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { ContentPlan } from "../_components/content-plan";
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

  const user = await getSessionUser();
  if (!user) redirect("/login");

  let data: Awaited<ReturnType<typeof getBrandStrategy>>;
  try {
    data = await getBrandStrategy(user.id);
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

  const { brand, pillars, latestDraftByTopic } = data;
  // Archived topics are tucked away: excluded from quick-generate, but the
  // Content Plan tree itself still renders (with its own "show archived"
  // toggle) as long as ANY topic exists, archived or not, so archived-only
  // brands can still reach the toggle to unarchive.
  const allTopics = pillars.flatMap((p) =>
    p.clusters.flatMap((c) =>
      c.topics
        .filter((t) => !t.archived)
        .map((t) => ({ id: t.id, title: t.title, pillarName: p.name })),
    ),
  );
  const hasAnyTopics = pillars.some((p) =>
    p.clusters.some((c) => c.topics.length > 0),
  );

  const hasTopics = allTopics.length > 0;

  return (
    <div className="relative">
      {/* Same ambient stage as the dashboard: brand light over a hairline
          grid, dissolving into the background. */}
      <div
        aria-hidden
        className="tech-grid absolute -inset-x-10 -top-16 -z-10 h-96"
      />
      <div
        aria-hidden
        className="aura-spectrum absolute -inset-x-10 -top-16 -z-10 h-80"
      />

      <ScreenHeader
        title="Create"
        subtitle="Tell it what you want to send, or pick from your content plan."
      />

      {/* Hero: the campaign conversation is the main way to create. Wears the
          same living ring as the dashboard chat bar — one system. */}
      <div className="hero-ring hero-surface mb-6 flex flex-col items-start justify-between gap-4 rounded-[var(--radius-card)] border border-border p-7 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-[19px] font-semibold text-foreground">
            What do you want to{" "}
            <span className="relative inline-block">
              send
              <span
                aria-hidden
                className="bar-spectrum bar-live absolute -bottom-0.5 left-0 h-[2.5px] w-full rounded-full"
              />
            </span>
            ?
          </h2>
          <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted">
            A short conversation about the goal, the audience, and the message.
            Then your email is drafted from your brand brain.
          </p>
        </div>
        <LinkButton href="/campaigns/new" variant="gradient">
          Start a campaign
        </LinkButton>
      </div>

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

      {hasAnyTopics ? (
        <ContentPlan
          pillars={pillars}
          latestDraftByTopic={latestDraftByTopic}
          keywordDifficultyMax={brand.seo_defaults?.keyword_difficulty_max}
        />
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
    </div>
  );
}
