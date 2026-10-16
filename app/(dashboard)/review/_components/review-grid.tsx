"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, SegmentedControl, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DraftStatusSummary } from "@/lib/db/queries";
import type { FactoryKind } from "@/lib/db/types";
import { FACTORY_KIND_LABELS } from "@/prompts/campaign-formats";
import { PieceCard } from "../../_components/piece-card";

const KIND_ORDER: FactoryKind[] = ["social", "ad", "email", "blog"];

/** A piece with no status row yet is still being made. */
function pendingPiece(id: string): DraftStatusSummary {
  return {
    id,
    kind: "email",
    state: "in_review",
    generation: "generating",
    imageUrl: null,
    subject: "",
    qaIssues: 0,
    estimatedUsd: 0,
  };
}

export function ReviewGrid({
  items,
  statuses,
}: {
  items: { id: string; title: string }[];
  statuses: Record<string, DraftStatusSummary>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [approving, setApproving] = useState(false);
  const [kind, setKind] = useState<FactoryKind | "all">("all");
  // Select mode: tapping a card ticks it instead of opening it.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ready = items.filter((i) => statuses[i.id]?.generation === "ready");

  const pieces = items.map((item) => ({
    piece: statuses[item.id] ?? pendingPiece(item.id),
    title: statuses[item.id]?.subject || item.title,
  }));
  const kinds = KIND_ORDER.map((k) => ({
    k,
    n: pieces.filter((p) => p.piece.kind === k).length,
  })).filter(({ n }) => n > 0);
  const shown = kind === "all" ? pieces : pieces.filter((p) => p.piece.kind === kind);

  async function approveAll() {
    setApproving(true);
    try {
      const res = await fetch("/api/review/approve-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: ready.map((i) => i.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        approved?: number;
        needsLook?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Couldn't approve them.");
      toast.success(`Approved ${data.approved}.`);
      if (data.needsLook?.length) {
        toast.warning(
          `${data.needsLook.length} still use words your brand avoids. Open them to fix before approving.`,
        );
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't approve them.");
    } finally {
      setApproving(false);
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

  async function deleteSelected() {
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
      if (!res.ok) throw new Error(data.error ?? "Couldn't delete them.");
      toast.success(`Deleted ${data.deleted}.`);
      if (data.published) {
        toast.warning(`${data.published} already published, so they were kept.`);
      }
      stopSelecting();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete them.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        {kinds.length > 1 && (
          <div className="no-scrollbar -ml-4 min-w-0 flex-1 overflow-x-auto pl-4 sm:ml-0 sm:pl-0">
            <SegmentedControl
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: `All ${pieces.length}` },
                ...kinds.map(({ k, n }) => ({ value: k, label: `${FACTORY_KIND_LABELS[k]} ${n}` })),
              ]}
            />
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={selecting ? stopSelecting : () => setSelecting(true)}
          className="ml-auto shrink-0"
        >
          {selecting ? "Done" : "Select"}
        </Button>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map(({ piece, title }) => {
          const isSelected = selected.has(piece.id);
          return (
            <li key={piece.id} className="relative">
              <PieceCard piece={piece} title={title} />
              {/* Sits over the card's link so a tap ticks instead of opening. */}
              {selecting && (
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`Select ${title}`}
                  onClick={() => toggle(piece.id)}
                  className={cn(
                    "absolute inset-0 z-10 rounded-[var(--radius-lg)] border-2 transition-colors",
                    isSelected ? "border-accent bg-accent/10" : "border-transparent",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2",
                      isSelected ? "border-accent bg-accent" : "border-white/80 bg-black/40",
                    )}
                  >
                    {isSelected && (
                      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 stroke-white stroke-[2.5]">
                        <path d="M4 8.3l2.6 2.6L12 5.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {selecting ? (
        <div className="sticky bottom-[calc(88px+var(--sab))] z-20 md:bottom-6">
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border-strong bg-surface/90 p-2.5 pl-4 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <p className="min-w-0 text-[13.5px] leading-snug text-muted">
              <span className="font-semibold text-foreground">{selected.size} selected.</span> Tap
              cards to pick.
            </p>
            <Button
              variant="solid"
              size="sm"
              disabled={!selected.size}
              onClick={() => setConfirmDelete(true)}
              className="shrink-0 bg-danger hover:bg-danger/90"
            >
              Delete {selected.size || ""}
            </Button>
          </div>
        </div>
      ) : ready.length > 0 && (
        // Rides above the mobile tab bar (and its raised Create button) while
        // scrolling the grid; settles in place once the grid ends.
        <div className="sticky bottom-[calc(88px+var(--sab))] z-20 md:bottom-6">
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border-strong bg-surface/90 p-2.5 pl-4 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <p className="min-w-0 text-[13.5px] leading-snug text-muted">
              <span className="font-semibold text-foreground">{ready.length} ready.</span> Open
              any to check it first.
            </p>
            <Button
              variant="gradient"
              size="sm"
              loading={approving}
              onClick={approveAll}
              className="shrink-0"
            >
              Approve all {ready.length}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void deleteSelected()}
        tone="danger"
        title={`Delete ${selected.size} permanently?`}
        description="This removes them and their edit history. It can't be undone."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}
