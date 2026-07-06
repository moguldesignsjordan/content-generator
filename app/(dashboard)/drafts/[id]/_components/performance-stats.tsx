"use client";

import { useState } from "react";
import { Button, StatCard, useToast } from "@/components/ui";
import type { PerformanceMetric } from "@/lib/db/types";

// Plan 2 analytics loop: read-only stat cards + an explicit "Refresh stats"
// tap (no auto-polling) for an already-published email's MailerLite numbers.

function formatMetric(metric: string, value: number): string {
  if (metric.endsWith("_rate")) return `${Math.round(value * 100)}%`;
  return value.toLocaleString();
}

const LABELS: Record<string, string> = {
  sent: "Sent",
  opens: "Opens",
  open_rate: "Open rate",
  clicks: "Clicks",
  click_rate: "Click rate",
};

export function PerformanceStats({
  draftId,
  initialMetrics,
}: {
  draftId: string;
  initialMetrics: PerformanceMetric[];
}) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/performance`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        metrics?: PerformanceMetric[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Couldn't refresh stats.");
      setMetrics(data.metrics ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't refresh stats.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted">Performance</p>
        <Button variant="subtle" size="sm" loading={refreshing} onClick={handleRefresh}>
          {refreshing ? "Refreshing…" : "Refresh stats"}
        </Button>
      </div>
      {metrics.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          {metrics.map((m) => (
            <StatCard
              key={m.metric}
              label={LABELS[m.metric] ?? m.metric}
              value={formatMetric(m.metric, m.value)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted">
          No stats yet. Tap Refresh stats once MailerLite has delivery data.
        </p>
      )}
    </div>
  );
}
