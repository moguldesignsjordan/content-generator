"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, SegmentedControl, useToast } from "@/components/ui";
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

  return (
    <div className="space-y-5">
      {kinds.length > 1 && (
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
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

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map(({ piece, title }) => (
          <li key={piece.id}>
            <PieceCard piece={piece} title={title} />
          </li>
        ))}
      </ul>

      {ready.length > 0 && (
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
    </div>
  );
}
