"use client";

import { useState } from "react";
import { Button, ConfirmDialog, useToast } from "@/components/ui";

export type BulkSelect = ReturnType<typeof useBulkSelect>;

/** Select mode for a Media tab: tapping an item ticks it instead of acting on it. */
export function useBulkSelect() {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stop() {
    setSelecting(false);
    setSelected(new Set());
  }

  return { selecting, selected, toggle, start: () => setSelecting(true), stop };
}

export function SelectToggle({ bulk }: { bulk: BulkSelect }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={bulk.selecting ? bulk.stop : bulk.start}
      className="shrink-0"
    >
      {bulk.selecting ? "Done" : "Select"}
    </Button>
  );
}

/**
 * The bottom bar and confirm for deleting the ticked items. Each goes through
 * the tab's own DELETE `${endpoint}/${id}` route, which checks the brand and
 * removes the stored file, so bulk follows the same rules as one at a time.
 */
export function BulkDeleteBar({
  bulk,
  endpoint,
  description,
  onDeleted,
}: {
  bulk: BulkSelect;
  endpoint: string;
  description: string;
  onDeleted: (ids: string[]) => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const count = bulk.selected.size;

  async function handleDelete() {
    setDeleting(true);
    const ids = [...bulk.selected];
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`${endpoint}/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        return id;
      }),
    );
    const done = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    onDeleted(done);
    if (done.length) toast.success(`Deleted ${done.length}.`);
    if (done.length < ids.length) toast.error(`${ids.length - done.length} couldn't be deleted.`);
    setDeleting(false);
    setConfirming(false);
    bulk.stop();
  }

  if (!bulk.selecting) return null;

  return (
    <>
      <div className="sticky bottom-[calc(88px+var(--sab))] z-20 md:bottom-6">
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border-strong bg-surface/90 p-2.5 pl-4 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <p className="min-w-0 text-[13.5px] leading-snug text-muted">
            <span className="font-semibold text-foreground">{count} selected.</span>
          </p>
          <Button
            variant="solid"
            size="sm"
            disabled={!count}
            onClick={() => setConfirming(true)}
            className="shrink-0 bg-danger hover:bg-danger/90"
          >
            Delete {count || ""}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title={`Delete ${count} permanently?`}
        description={description}
        confirmLabel="Delete"
        loading={deleting}
      />
    </>
  );
}
