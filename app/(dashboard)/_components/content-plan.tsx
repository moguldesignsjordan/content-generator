"use client";

import { useState } from "react";
import type { PillarWithClusters } from "@/lib/db/types";
import { FunnelBadge } from "./topic-badges";
import { ClusterCard } from "./cluster-card";

interface ContentPlanProps {
  pillars: PillarWithClusters[];
  latestDraftByTopic: Record<string, { id: string; state: string; version: number }>;
}

/** The Content Plan tree with a toggle to reveal archived topics. */
export function ContentPlan({ pillars, latestDraftByTopic }: ContentPlanProps) {
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = pillars.reduce(
    (sum, p) =>
      sum + p.clusters.reduce((s, c) => s + c.topics.filter((t) => t.archived).length, 0),
    0,
  );

  return (
    <div>
      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="mb-4 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
        >
          {showArchived
            ? "Hide archived topics"
            : `Show archived topics (${archivedCount})`}
        </button>
      )}
      <div className="space-y-9">
        {pillars.map((pillar) => (
          <section key={pillar.id}>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="font-display text-[16px] font-semibold tracking-tight text-foreground">
                {pillar.name}
              </h3>
              <FunnelBadge stage={pillar.primary_funnel_stage} />
            </div>
            {pillar.description && (
              <p className="mb-4 max-w-2xl text-[14px] leading-relaxed text-muted">
                {pillar.description}
              </p>
            )}
            <div className="space-y-4">
              {pillar.clusters.map((cluster) => (
                <ClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  latestDraftByTopic={latestDraftByTopic}
                  showArchived={showArchived}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
