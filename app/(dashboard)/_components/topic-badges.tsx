import Link from "next/link";
import type { FunnelStage, TopicStatus } from "@/lib/db/types";

const STATUS_STYLES: Record<TopicStatus, string> = {
  idea: "bg-border text-muted",
  queued: "bg-accent/20 text-accent",
  in_progress: "bg-amber-500/20 text-amber-300",
  published: "bg-emerald-500/20 text-emerald-300",
};

export function StatusBadge({ status }: { status: TopicStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export function FunnelBadge({ stage }: { stage: FunnelStage }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
      {stage}
    </span>
  );
}

const DRAFT_STATE_STYLES: Record<string, string> = {
  in_review: "text-amber-300 hover:text-amber-200",
  approved: "text-emerald-400 hover:text-emerald-300",
  rejected: "text-muted hover:text-foreground",
  superseded: "text-muted hover:text-foreground",
};

export function DraftLink({
  draft,
}: {
  draft: { id: string; state: string; version: number };
}) {
  const cls =
    DRAFT_STATE_STYLES[draft.state] ?? "text-muted hover:text-foreground";
  return (
    <Link
      href={`/drafts/${draft.id}`}
      className={`text-xs transition ${cls}`}
    >
      v{draft.version} {draft.state.replace("_", " ")} →
    </Link>
  );
}
