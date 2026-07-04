"use client";

import { useState } from "react";
import { Card, ListGroup, ListRow, SegmentedControl } from "@/components/ui";
import { DraftStateBadge } from "../_components/topic-badges";

type Filter = "all" | "in_review" | "approved" | "archived";

export interface DraftRow {
  id: string;
  topic_title: string | null;
  subject: string;
  state: string;
  version: number;
  archived: boolean;
  created_at: string;
}

export function EmailsList({ drafts }: { drafts: DraftRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  // Archived drafts are hidden from all/review/approved (tucked away by
  // design); the Archived tab is the only place they show.
  const active = drafts.filter((d) => !d.archived);
  const counts = {
    all: active.length,
    in_review: active.filter((d) => d.state === "in_review").length,
    approved: active.filter((d) => d.state === "approved").length,
    archived: drafts.filter((d) => d.archived).length,
  };
  const filtered =
    filter === "archived"
      ? drafts.filter((d) => d.archived)
      : filter === "all"
        ? active
        : active.filter((d) => d.state === filter);

  return (
    <div>
      <SegmentedControl
        className="mb-5"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={[
          { value: "all", label: `All ${counts.all}` },
          { value: "in_review", label: `Review ${counts.in_review}` },
          { value: "approved", label: `Approved ${counts.approved}` },
          ...(counts.archived > 0
            ? [{ value: "archived" as const, label: `Archived ${counts.archived}` }]
            : []),
        ]}
      />

      {filtered.length === 0 ? (
        <Card className="p-7 text-center">
          <p className="text-sm text-muted">
            {filter === "all"
              ? "No emails yet. Ask the assistant to draft one, or generate from a topic in Create."
              : "Nothing here in this state yet."}
          </p>
        </Card>
      ) : (
        <ListGroup>
          {filtered.map((d) => (
            <ListRow
              key={d.id}
              href={`/drafts/${d.id}`}
              title={d.subject || "Untitled draft"}
              subtitle={
                d.topic_title ? `${d.topic_title} · v${d.version}` : `v${d.version}`
              }
              trailing={<DraftStateBadge state={d.state} />}
            />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
