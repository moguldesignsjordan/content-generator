"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  ConfirmDialog,
  ListGroup,
  SegmentedControl,
  Spinner,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  ArchiveIcon,
  TrashIcon,
  UnarchiveIcon,
} from "@/components/ui/icons";
import type { DraftListRow } from "@/lib/db/types";
import { DraftStateBadge } from "./topic-badges";

type Filter = "all" | "in_review" | "approved" | "archived";
type Kind = "email" | "blog" | "social";

/**
 * The shared Emails/Blogs list. Both tabs are the same flat list of drafts,
 * scoped by kind at the query layer; this component only varies a little copy
 * and (for blogs) shows the email a post grew out of. Archive/delete actions
 * are identical for both kinds.
 */
export function DraftsList({
  drafts,
  kind,
}: {
  drafts: DraftListRow[];
  kind: Kind;
}) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");

  // actingId = a row with archive/unarchive in flight (shows a spinner on its
  // button); confirmDeleteId = a row awaiting delete confirmation.
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function handleArchive(draftId: string, archive: boolean) {
    setActingId(draftId);
    try {
      const res = await fetch(`/api/drafts/${draftId}/archive`, {
        method: archive ? "POST" : "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success(archive ? "Archived." : "Unarchived.");
      router.refresh();
    } catch {
      toast.error(`Failed to ${archive ? "archive" : "unarchive"}.`);
    } finally {
      setActingId(null);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/drafts/${confirmDeleteId}`, {
        method: "DELETE",
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error ??
            "This draft was published, so it can't be deleted. Archive it instead.",
        );
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to delete.");
      }
      toast.success("Draft deleted.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  const emptyCopy =
    kind === "blog"
      ? "No blog posts yet. Open an email's review page and tap Create blog post, or generate one from a topic in Create."
      : kind === "social"
        ? "No flyers yet. Tap New flyer to design one from a topic or a quick brief."
        : "No emails yet. Ask the assistant to draft one, or generate from a topic in Create.";

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
            {filter === "all" ? emptyCopy : "Nothing here in this state yet."}
          </p>
        </Card>
      ) : (
        <ListGroup>
          {filtered.map((d) => (
            <div
              key={d.id}
              className={cn(
                "flex w-full items-center gap-2 px-4 py-3 text-left transition-colors min-h-[52px] hover:bg-surface-2 active:bg-surface-3",
                d.archived && "opacity-60",
              )}
            >
              {/* The whole text block opens the draft. Action buttons and the
                  source-email link are siblings, not children, so they never
                  navigate to the draft. */}
              <Link href={`/drafts/${d.id}`} className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-foreground">
                  {d.subject || "Untitled draft"}
                </div>
                <div className="mt-0.5 truncate text-[13px] text-muted">
                  {[d.topic_title, `v${d.version}`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </Link>

              {/* A blog spun off an email: jump straight to that email. Sibling
                  link (not nested) and desktop-only, so mobile keeps a clean
                  row; mobile reaches it from the review screen. */}
              {d.source_draft_id && (
                <Link
                  href={`/drafts/${d.source_draft_id}`}
                  title={d.source_subject ?? "Open the email this came from"}
                  className="hidden max-w-[38%] shrink-0 truncate text-[12px] font-medium text-muted transition-colors hover:text-accent sm:block"
                >
                  From “{d.source_subject || "email"}”
                </Link>
              )}

              <DraftStateBadge state={d.state} />

              <RowIconButton
                label={d.archived ? "Unarchive" : "Archive"}
                loading={actingId === d.id}
                disabled={!!actingId}
                onClick={() => handleArchive(d.id, !d.archived)}
              >
                {d.archived ? <UnarchiveIcon size={18} /> : <ArchiveIcon size={18} />}
              </RowIconButton>
              <RowIconButton
                label="Delete"
                danger
                disabled={!!actingId || deleting}
                onClick={() => setConfirmDeleteId(d.id)}
              >
                <TrashIcon size={18} />
              </RowIconButton>
            </div>
          ))}
        </ListGroup>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this draft permanently?"
        description="This removes the draft and its edit history. It can't be undone. If you might still want it, archive it instead."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}

function RowIconButton({
  label,
  onClick,
  disabled,
  loading,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        danger && "hover:bg-danger/10 hover:text-danger",
      )}
    >
      {loading ? <Spinner size={16} /> : children}
    </button>
  );
}
