"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, ListGroup, SegmentedControl } from "@/components/ui";
import { ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { CampaignSummary } from "@/lib/db/types";
import { CampaignStatusBadge } from "./topic-badges";

type Filter = "all" | "active" | "done";

/**
 * The Campaigns list: every campaign, newest-updated first, with its send
 * progress and an expandable row to jump straight into any of its series
 * emails without a separate detail page.
 */
export function CampaignsList({ campaigns }: { campaigns: CampaignSummary[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = {
    all: campaigns.length,
    active: campaigns.filter((c) => c.status !== "done").length,
    done: campaigns.filter((c) => c.status === "done").length,
  };
  const filtered =
    filter === "all"
      ? campaigns
      : filter === "done"
        ? campaigns.filter((c) => c.status === "done")
        : campaigns.filter((c) => c.status !== "done");

  if (campaigns.length === 0) {
    return (
      <Card className="p-7 text-center">
        <p className="text-sm text-muted">
          No campaigns yet. Start one from Create, or{" "}
          <Link href="/campaigns/new" className="font-medium text-accent hover:text-accent-press">
            plan a campaign
          </Link>
          .
        </p>
      </Card>
    );
  }

  return (
    <div>
      <SegmentedControl
        className="mb-5"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={[
          { value: "all", label: `All ${counts.all}` },
          { value: "active", label: `Active ${counts.active}` },
          { value: "done", label: `Done ${counts.done}` },
        ]}
      />

      {filtered.length === 0 ? (
        <Card className="p-7 text-center">
          <p className="text-sm text-muted">Nothing here in this state yet.</p>
        </Card>
      ) : (
        <ListGroup>
          {filtered.map((c) => {
            const series = c.chat_state?.series ?? [];
            const isOpen = expanded === c.id;
            const title = c.brief.goal?.trim() || "Untitled campaign";
            const subtitleParts = [
              `${c.emails} email${c.emails === 1 ? "" : "s"}`,
              c.sent > 0 ? `${c.sent} sent` : null,
              c.scheduled > 0 ? `${c.scheduled} scheduled` : null,
              new Date(c.updated_at).toLocaleDateString(),
            ].filter(Boolean);

            return (
              <div key={c.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-surface-3"
                >
                  <ChevronRightIcon
                    size={16}
                    className={cn(
                      "shrink-0 text-muted-2 transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-foreground">
                      {title}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted">
                      {subtitleParts.join(" · ")}
                    </div>
                  </div>
                  <CampaignStatusBadge status={c.status} />
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-surface-2/40 px-4 py-2">
                    {series.length > 0 ? (
                      <div className="divide-y divide-border">
                        {series.map((item, i) => (
                          <Link
                            key={item.draft_id}
                            href={`/drafts/${item.draft_id}`}
                            className="group flex items-center gap-3 py-2 text-[13.5px]"
                          >
                            <span className="w-5 shrink-0 text-right tabular-nums text-muted-2">
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-accent">
                              {item.title}
                            </span>
                            {item.email_type && (
                              <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] capitalize text-muted">
                                {item.email_type}
                              </span>
                            )}
                            <span className="shrink-0 text-[12px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                              Open
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="py-2 text-[13px] text-muted">
                        No emails yet.{" "}
                        <Link
                          href="/campaigns/new"
                          className="font-medium text-accent hover:text-accent-press"
                        >
                          Open in the create chat
                        </Link>{" "}
                        to continue this campaign.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </ListGroup>
      )}
    </div>
  );
}
