"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  LinkButton,
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
import { PIECE_ART } from "./art";
import { DraftStateBadge } from "./topic-badges";

type Filter = "all" | "in_review" | "approved" | "archived";
type Kind = "email" | "blog" | "social";

const EMPTY: Record<Kind, { title: string; body: string; href: string; cta: string }> = {
  email: {
    title: "No emails yet",
    body: "Start one on Create: tap Email and say what it's about. Nothing sends until you approve it.",
    href: "/",
    cta: "Make an email",
  },
  blog: {
    title: "No blog posts yet",
    body: "Open an email's review page and tap Create blog post, or start one on Create.",
    href: "/",
    cta: "Write a post",
  },
  social: {
    title: "No flyers yet",
    body: "Design one from a topic or a quick brief, then pick from 4 options.",
    href: "/flyers/new",
    cta: "New flyer",
  },
};

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
  // Select mode swaps each row's actions for a checkbox and opens a bulk
  // delete bar.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

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

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    setDeleting(true);
    try {
      const res = await fetch("/api/drafts/delete-many", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: [...selected] }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        deleted?: number;
        published?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete.");
      toast.success(`Deleted ${data.deleted}.`);
      if (data.published) {
        toast.warning(
          `${data.published} already published, so they were kept. Archive them instead.`,
        );
      }
      stopSelecting();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setDeleting(false);
      setConfirmBulk(false);
    }
  }

  const empty = EMPTY[kind];

  return (
    <div>
      {drafts.length > 0 && (
        <div className="mb-5 flex items-center gap-3">
          <div className="no-scrollbar -ml-4 min-w-0 flex-1 overflow-x-auto pl-4 sm:ml-0 sm:pl-0">
            <SegmentedControl
              value={filter}
              onChange={(v) => {
                setFilter(v as Filter);
                // A tick on a row the new tab hides would be deleted unseen.
                setSelected(new Set());
              }}
              options={[
                { value: "all", label: `All ${counts.all}` },
                { value: "in_review", label: `Review ${counts.in_review}` },
                { value: "approved", label: `Approved ${counts.approved}` },
                ...(counts.archived > 0
                  ? [{ value: "archived" as const, label: `Archived ${counts.archived}` }]
                  : []),
              ]}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={selecting ? stopSelecting : () => setSelecting(true)}
            className="ml-auto shrink-0"
          >
            {selecting ? "Done" : "Select"}
          </Button>
        </div>
      )}

      {filtered.length === 0 && filter === "all" ? (
        <EmptyState
          art={PIECE_ART[kind]}
          title={empty.title}
          action={
            <LinkButton href={empty.href} variant="outline" size="sm">
              {empty.cta}
            </LinkButton>
          }
        >
          {empty.body}
        </EmptyState>
      ) : filtered.length === 0 ? (
        <Card className="p-7 text-center">
          <p className="text-sm text-muted">Nothing here in this state yet.</p>
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
              {/* The whole text block opens the draft (or ticks it in select
                  mode). Action buttons and the source-email link are siblings,
                  not children, so they never navigate to the draft. */}
              {selecting ? (
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <Checkbox checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  <DraftRowText draft={d} />
                </label>
              ) : (
                <Link href={`/drafts/${d.id}`} className="min-w-0 flex-1">
                  <DraftRowText draft={d} />
                </Link>
              )}

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

              {!selecting && (
                <>
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
                </>
              )}
            </div>
          ))}
        </ListGroup>
      )}

      {selecting && (
        <div className="sticky bottom-[calc(88px+var(--sab))] z-20 mt-5 md:bottom-6">
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border-strong bg-surface/90 p-2.5 pl-4 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <p className="min-w-0 text-[13.5px] leading-snug text-muted">
              <span className="font-semibold text-foreground">{selected.size} selected.</span>
            </p>
            <Button
              variant="solid"
              size="sm"
              disabled={!selected.size}
              onClick={() => setConfirmBulk(true)}
              className="shrink-0 bg-danger hover:bg-danger/90"
            >
              Delete {selected.size || ""}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        onConfirm={() => void handleBulkDelete()}
        tone="danger"
        title={`Delete ${selected.size} permanently?`}
        description="This removes them and their edit history. It can't be undone. Published ones are kept."
        confirmLabel="Delete"
        loading={deleting}
      />

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

function DraftRowText({ draft }: { draft: DraftListRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[15px] font-medium text-foreground">
        {draft.subject || "Untitled draft"}
      </div>
      <div className="mt-0.5 truncate text-[13px] text-muted">
        {[draft.topic_title, `v${draft.version}`].filter(Boolean).join(" · ")}
      </div>
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
