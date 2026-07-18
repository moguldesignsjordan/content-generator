import Link from "next/link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSessionUser } from "@/lib/supabase/server";
import {
  countScheduledAwaitingReview,
  getBrandStrategy,
  getBrandWithIcps,
  getLatestActiveCampaign,
  listProducts,
} from "@/lib/db/queries";
import { buildBriefCard, topicContextFor } from "@/lib/brief-card";
import { Card, LinkButton } from "@/components/ui";
import { CreateAgent } from "./_components/create-agent";

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

  const user = await getSessionUser();
  if (!user) redirect("/login");

  let data: Awaited<ReturnType<typeof getBrandStrategy>>;
  try {
    data = await getBrandStrategy(user.id);
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
  const [withIcps, products, activeCampaign, scheduledAwaitingReview] =
    await Promise.all([
      getBrandWithIcps(user.id).catch(() => null),
      listProducts(brand.id).catch(() => []),
      getLatestActiveCampaign(brand.id).catch(() => null),
      countScheduledAwaitingReview(brand.id).catch(() => 0),
    ]);
  const allTopics = pillars.flatMap((p) =>
    p.clusters.flatMap((c) =>
      c.topics.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        funnel_stage: t.funnel_stage,
      })),
    ),
  );

  // Resume the create-agent thread on reload instead of starting blank, but
  // only when there's an actual conversation to resume.
  const activeMessages = activeCampaign?.chat_state?.messages ?? [];
  const primaryIcp =
    withIcps?.icps.find((i) => i.is_primary) ?? withIcps?.icps[0] ?? null;
  const createAgentInitial =
    activeCampaign && activeMessages.length > 0
      ? {
          campaignId: activeCampaign.id,
          messages: activeMessages,
          topicId: activeCampaign.topic_id,
          series: activeCampaign.chat_state?.series ?? null,
          auto: activeCampaign.chat_state?.auto ?? false,
          ready: !!(
            activeCampaign.brief.goal &&
            activeCampaign.brief.key_message &&
            activeCampaign.topic_id
          ),
          card: buildBriefCard({
            brand,
            strategy: data.strategy,
            primaryIcp,
            products,
            brief: activeCampaign.brief,
            ...topicContextFor(activeCampaign.topic_id, allTopics),
          }),
        }
      : undefined;

  return (
    <div className="relative space-y-6">
      {/* Ambient stage behind the top of the screen: brand light over a
          hairline engineering grid that dissolves into the background. */}
      <div
        aria-hidden
        className="tech-grid absolute -inset-x-10 -top-16 -z-10 h-96"
      />
      <div
        aria-hidden
        className="aura-spectrum absolute -inset-x-10 -top-16 -z-10 h-80"
      />

      {brand.onboarding_state?.completed !== true && <FinishSetupBanner />}

      {/* Create — the work surface. Quick actions + an animated type box. */}
      <CreateAgent initial={createAgentInitial} />

      {/* Scheduled drafts awaiting review (Settings → Schedules). Never
          auto-publishes; this is just a nudge to go approve/reject. */}
      {scheduledAwaitingReview > 0 && (
        <Link
          href="/emails"
          className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-accent/25 bg-accent/[0.07] px-4 py-3 transition-colors hover:bg-accent/[0.12]"
        >
          <span className="text-[14px]">
            <span className="font-medium text-foreground">
              {scheduledAwaitingReview} scheduled draft
              {scheduledAwaitingReview === 1 ? "" : "s"} awaiting review.
            </span>{" "}
            <span className="text-muted">Auto-generated, still needs your approval.</span>
          </span>
          <span className="shrink-0 text-[13px] font-medium text-accent">View →</span>
        </Link>
      )}
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
