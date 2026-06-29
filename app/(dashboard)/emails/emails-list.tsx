"use client";

import { useState } from "react";
import { Card, ListGroup, ListRow, SegmentedControl } from "@/components/ui";
import { DraftStateBadge } from "../_components/topic-badges";

type Filter = "all" | "in_review" | "approved";

export interface DraftRow {
  id: string;
  topic_title: string | null;
  subject: string;
  state: string;
  version: number;
  created_at: string;
}

export function EmailsList({ drafts }: { drafts: DraftRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = {
    all: drafts.length,
    in_review: drafts.filter((d) => d.state === "in_review").length,
    approved: drafts.filter((d) => d.state === "approved").length,
  };
  const filtered =
    filter === "all" ? drafts : drafts.filter((d) => d.state === filter);

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
