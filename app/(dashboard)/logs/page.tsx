import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getLogStats, getUserRole, listRecentLogs } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { Card, StatCard } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { LogsFeed } from "./_components/logs-feed";

// Always read fresh; this is a live feed.
export const dynamic = "force-dynamic";

export default async function LogsPage() {
  // Admin-only, in addition to the nav link already being hidden (defense
  // in depth — the nav hides the link, this stops direct navigation to
  // /logs). 404s rather than redirects so the page's existence isn't
  // signaled to non-admins.
  if (isSupabaseAuthConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const role = user && isSupabaseConfigured() ? await getUserRole(user.id) : "user";
    if (role !== "admin") notFound();
  }

  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local, then apply
          db/migrations/011_app_logs.sql to enable the logs feed.
        </p>
      </Card>
    );
  }

  const [logs, stats] = await Promise.all([
    listRecentLogs().catch(() => []),
    getLogStats().catch(() => ({
      errorCount24h: 0,
      warnCount24h: 0,
      usageCount24h: 0,
      estimatedUsd24h: 0,
    })),
  ]);

  return (
    <>
      <ScreenHeader
        title="Logs"
        subtitle="Live feed of errors, warnings, and Claude token usage across the app."
      />

      <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Errors" value={stats.errorCount24h} sub="last 24h" />
        <StatCard label="Warnings" value={stats.warnCount24h} sub="last 24h" />
        <StatCard label="Claude calls" value={stats.usageCount24h} sub="last 24h" />
        <StatCard
          label="Est. spend"
          value={`$${stats.estimatedUsd24h.toFixed(2)}`}
          sub="last 24h"
        />
      </div>

      <LogsFeed initialLogs={logs} />
    </>
  );
}
