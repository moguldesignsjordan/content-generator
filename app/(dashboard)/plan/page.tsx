import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSessionUser } from "@/lib/supabase/server";
import { getBrandStrategy } from "@/lib/db/queries";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { ContentPlan } from "../_components/content-plan";
import { SuggestTopics } from "../_components/suggest-topics";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
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
  // The tree still renders (with its own "show archived" toggle) as long as
  // ANY topic exists, archived or not, so archived-only brands can still
  // reach the toggle to unarchive.
  const liveTopics = pillars
    .flatMap((p) => p.clusters.flatMap((c) => c.topics))
    .filter((t) => !t.archived);
  const hasAnyTopics = pillars.some((p) =>
    p.clusters.some((c) => c.topics.length > 0),
  );

  const hasTopics = liveTopics.length > 0;
  const queuedCount = liveTopics.filter((t) => t.status === "queued").length;

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
        title="Content plan"
        subtitle="Your backlog of ideas. Generate from any topic, or start from Create."
      />

      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted">
          {hasTopics ? `${liveTopics.length} topics · ${queuedCount} queued` : ""}
        </span>
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
