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
  listTopPerformingEmails,
} from "@/lib/db/queries";
import type { Icp } from "@/lib/db/types";
import { buildBriefCard, topicContextFor } from "@/lib/brief-card";
import { Card, LinkButton } from "@/components/ui";
import {
  CreateAgent,
  type CreateAgentInitialState,
  type CreateAgentSuggestion,
} from "./_components/create-agent";

// Always read fresh from the DB.
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase to continue</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local, apply db/schema.sql, and run npm run seed.
        </p>
      </Card>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await getBrandWithIcps(user.id).catch(() => null);
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

  // "New campaign" links land here with ?mode=campaign: skip straight past
  // "what are we creating?".
  const startKind = (await searchParams).mode === "campaign" ? "campaign" : undefined;
  const [awaitingReview, chat] = await Promise.all([
    countScheduledAwaitingReview(data.brand.id).catch(() => 0),
    loadChat(user.id, data.icps),
  ]);

  return (
    <div className="relative space-y-6">
      <div aria-hidden className="tech-grid absolute -inset-x-10 -top-16 -z-10 h-96" />
      <div aria-hidden className="aura-spectrum absolute -inset-x-10 -top-16 -z-10 h-80" />

      {data.brand.onboarding_state?.completed !== true && <FinishSetupBanner />}

      <CreateAgent
        // A "New campaign" link starts fresh instead of resuming the last chat.
        initial={startKind ? undefined : chat.initial}
        suggestions={chat.suggestions}
        startKind={startKind}
      />

      {awaitingReview > 0 && (
        <Link
          href="/emails"
          className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-accent/25 bg-accent/[0.07] px-4 py-3 transition-colors hover:bg-accent/[0.12]"
        >
          <span className="text-[14px]">
            <span className="font-medium text-foreground">
              {awaitingReview} scheduled draft{awaitingReview === 1 ? "" : "s"} awaiting review.
            </span>{" "}
            <span className="text-muted">Auto-generated, still needs your approval.</span>
          </span>
          <span className="shrink-0 text-[13px] font-medium text-accent">View →</span>
        </Link>
      )}
    </div>
  );
}

/**
 * The Create chat's starters and resumable thread: the next queued topics,
 * "another like" the best performer, and the latest in-flight conversation.
 * Any failure just means a blank chat, never a broken page.
 */
async function loadChat(
  userId: string,
  icps: Icp[],
): Promise<{ initial?: CreateAgentInitialState; suggestions: CreateAgentSuggestion[] }> {
  const data = await getBrandStrategy(userId).catch(() => null);
  if (!data) return { suggestions: [] };

  const { brand, pillars } = data;
  const [products, activeCampaign, topEmails] = await Promise.all([
    listProducts(brand.id).catch(() => []),
    getLatestActiveCampaign(brand.id).catch(() => null),
    listTopPerformingEmails(brand.id, 1).catch(() => []),
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

  const suggestions: CreateAgentSuggestion[] = pillars
    .flatMap((p) => p.clusters.flatMap((c) => c.topics))
    .filter((t) => !t.archived && t.status === "queued")
    .slice(0, 3)
    .map((t) => ({ label: t.title, text: `Write an email about "${t.title}"` }));
  const best = topEmails[0];
  if (best) {
    suggestions.push({
      label: `Another like "${best.subject}" (${Math.round(best.open_rate)}% opened)`,
      text:
        `Write a new email in the same spirit as my best performer, "${best.subject}" ` +
        `(${Math.round(best.open_rate)}% opens, ${Math.round(best.click_rate)}% clicks). ` +
        `It opened with: "${best.opening}". Same kind of hook, fresh topic.`,
    });
  }

  // Resume only when there's an actual conversation to pick back up.
  const activeMessages = activeCampaign?.chat_state?.messages ?? [];
  if (!activeCampaign || activeMessages.length === 0) return { suggestions };
  const primaryIcp = icps.find((i) => i.is_primary) ?? icps[0] ?? null;
  return {
    suggestions,
    initial: {
      campaignId: activeCampaign.id,
      messages: activeMessages,
      topicId: activeCampaign.topic_id,
      series: activeCampaign.chat_state?.series ?? null,
      preview: activeCampaign.chat_state?.preview
        ? {
            draftId: activeCampaign.chat_state.preview.draft_id,
            channel: activeCampaign.chat_state.preview.channel,
          }
        : null,
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
    },
  };
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
