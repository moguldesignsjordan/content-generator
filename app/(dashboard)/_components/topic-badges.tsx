import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui";
import type { FunnelStage, KeywordMetric, TopicStatus } from "@/lib/db/types";

const STATUS_TONES: Record<TopicStatus, BadgeTone> = {
  idea: "neutral",
  queued: "cyan",
  in_progress: "amber",
  published: "success",
};
const STATUS_LABELS: Record<TopicStatus, string> = {
  idea: "Idea",
  queued: "Queued",
  in_progress: "In progress",
  published: "Published",
};

export function StatusBadge({ status }: { status: TopicStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const FUNNEL_TONES: Record<FunnelStage, BadgeTone> = {
  awareness: "cyan",
  consideration: "violet",
  decision: "magenta",
  brand: "amber",
};

export function FunnelBadge({ stage }: { stage: FunnelStage }) {
  const label = stage[0].toUpperCase() + stage.slice(1);
  return <Badge tone={FUNNEL_TONES[stage]}>{label}</Badge>;
}

const DRAFT_TONES: Record<string, BadgeTone> = {
  in_review: "amber",
  approved: "success",
  rejected: "danger",
  superseded: "neutral",
  published: "success",
};
const DRAFT_LABELS: Record<string, string> = {
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
  published: "Published",
};

export function DraftStateBadge({ state }: { state: string }) {
  return (
    <Badge tone={DRAFT_TONES[state] ?? "neutral"} dot>
      {DRAFT_LABELS[state] ?? state}
    </Badge>
  );
}

/**
 * DataForSEO-validated numbers for a topic's primary keyword (Slice 4
 * "enrich" cut). Colored against the brand's keyword_difficulty_max, when
 * set: warning above the brand's comfort range, success at or under it.
 */
export function KeywordBadge({
  data,
  difficultyMax,
}: {
  data: KeywordMetric;
  difficultyMax?: number;
}) {
  const tone: BadgeTone =
    data.difficulty == null
      ? "neutral"
      : difficultyMax != null && data.difficulty > difficultyMax
        ? "warning"
        : "success";
  const parts = [
    data.search_volume != null ? `~${data.search_volume}/mo` : null,
    data.difficulty != null ? `diff ${data.difficulty}` : null,
  ].filter(Boolean);
  return <Badge tone={tone}>{parts.length ? parts.join(" · ") : "Researched"}</Badge>;
}

export function DraftLink({
  draft,
}: {
  draft: { id: string; state: string; version: number };
}) {
  return (
    <Link
      href={`/drafts/${draft.id}`}
      className="text-[13px] font-medium text-accent transition-colors hover:text-accent-press"
    >
      v{draft.version} {DRAFT_LABELS[draft.state] ?? draft.state} →
    </Link>
  );
}
