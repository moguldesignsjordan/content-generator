import Link from "next/link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSessionUser } from "@/lib/supabase/server";
import { countScheduledAwaitingReview, getBrandWithIcps } from "@/lib/db/queries";
import { Card, LinkButton } from "@/components/ui";
import { FactoryStart } from "./_components/factory-start";

// Always read fresh from the DB.
export const dynamic = "force-dynamic";

export default async function HomePage() {
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

  const awaitingReview = await countScheduledAwaitingReview(data.brand.id).catch(() => 0);

  return (
    <div className="relative space-y-6">
      <div aria-hidden className="tech-grid absolute -inset-x-10 -top-16 -z-10 h-96" />
      <div aria-hidden className="aura-spectrum absolute -inset-x-10 -top-16 -z-10 h-80" />

      <FactoryStart hasWebsite={Boolean(data.brand.visual_identity?.footer?.website)} />

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

      <p className="text-center text-[13px] text-muted">
        Need one quick piece instead?{" "}
        <Link href="/chat" className="font-medium text-accent hover:text-accent-press">
          Open quick chat
        </Link>
      </p>
    </div>
  );
}
