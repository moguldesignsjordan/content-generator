"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, ConfirmDialog, useToast } from "@/components/ui";
import { KIND_TONE } from "../../../_components/kind-tone";
import { cn } from "@/lib/cn";
import { useGenerationStream } from "@/lib/use-generation-stream";
import type { DraftStatusSummary } from "@/lib/db/queries";
import type { FactoryKind, FactoryPlanItem } from "@/lib/db/types";
import { FACTORY_KIND_LABELS, getCampaignFormat } from "@/prompts/campaign-formats";

// The launched half of a factory campaign: pieces generate three at a time
// over the normal generate-stream route (a closed tab just pauses the queue;
// reopening resumes it), then land here for review, approve-all, and
// scheduling. Every publish still needs this explicit approval.

const CONCURRENCY = 3;

type Settled = Record<string, "ready" | "error">;
type SettleFn = (draftId: string, status: "ready" | "error", error?: string) => void;

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function whereItGoes(item: FactoryPlanItem): string {
  if (item.kind === "social") return "Posts on its day once approved";
  if (item.kind === "ad") return "Run it from Ads Manager";
  if (item.kind === "email") return "Schedule below once approved";
  return "Publish from its review screen";
}

export function PiecesSection({
  campaignId,
  items,
  statuses,
  unitUsd,
}: {
  campaignId: string;
  items: FactoryPlanItem[];
  statuses: Record<string, DraftStatusSummary>;
  unitUsd: Record<FactoryKind, number>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [settled, setSettled] = useState<Settled>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [confirmSchedule, setConfirmSchedule] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const generationOf = (item: FactoryPlanItem) => {
    const id = item.draft_id!;
    if (retrying.has(id)) return "generating";
    return settled[id] ?? statuses[id]?.generation ?? "generating";
  };
  const queued = items.filter((i) => generationOf(i) === "generating");
  const active = new Set(queued.slice(0, CONCURRENCY).map((i) => i.draft_id!));

  const onSettle = useCallback<SettleFn>(
    (draftId, status, error) => {
      setSettled((s) => ({ ...s, [draftId]: status }));
      if (error) setErrors((e) => ({ ...e, [draftId]: error }));
      setRetrying((r) => {
        const next = new Set(r);
        next.delete(draftId);
        return next;
      });
      router.refresh();
    },
    [router],
  );

  const reviewable = items.filter(
    (i) => generationOf(i) === "ready" && statuses[i.draft_id!]?.state === "in_review",
  );
  const approvedEmails = items.filter(
    (i) => i.kind === "email" && statuses[i.draft_id!]?.state === "approved",
  );
  const finished = items.filter((i) => statuses[i.draft_id!]?.generation === "ready");
  const actualUsd = finished.reduce((sum, i) => sum + (statuses[i.draft_id!]?.estimatedUsd ?? 0), 0);
  const quotedUsd = finished.reduce((sum, i) => sum + (unitUsd[i.kind] ?? 0), 0);

  async function approveAll() {
    setApproving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/approve-all`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        approved?: number;
        needsLook?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Couldn't approve the pieces.");
      toast.success(`Approved ${data.approved} piece${data.approved === 1 ? "" : "s"}.`);
      if (data.needsLook?.length) {
        toast.warning(
          `${data.needsLook.length} still use words your brand avoids. Open them to fix before approving.`,
        );
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't approve the pieces.");
    } finally {
      setApproving(false);
    }
  }

  async function scheduleEmails() {
    setScheduling(true);
    let done = 0;
    const failures: string[] = [];
    for (const item of approvedEmails) {
      const res = await fetch(`/api/drafts/${item.draft_id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule: { type: "scheduled", date: item.date, hours: "10", minutes: "00" },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) done++;
      else failures.push(data.error ?? item.title);
    }
    setScheduling(false);
    setConfirmSchedule(false);
    if (done) toast.success(`Scheduled ${done} email${done === 1 ? "" : "s"} in MailerLite.`);
    if (failures.length) toast.error(failures[0]);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-semibold">Your pieces</h2>
          <p className="text-[14px] text-muted">
            {queued.length
              ? `Making ${queued.length} more, ${CONCURRENCY} at a time. Keep this page open; if you leave, they pick up again when you come back.`
              : "Everything here is made. Open any piece to edit it, or approve the batch."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {reviewable.length > 0 && (
            <Button variant="gradient" loading={approving} onClick={approveAll}>
              Approve all {reviewable.length} ready
            </Button>
          )}
          {approvedEmails.length > 0 && (
            <Button variant="outline" onClick={() => setConfirmSchedule(true)}>
              Schedule {approvedEmails.length} email{approvedEmails.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <PieceCard
            key={item.id}
            item={item}
            status={statuses[item.draft_id!]}
            generation={generationOf(item)}
            error={errors[item.draft_id!] ?? statuses[item.draft_id!]?.error}
            active={active.has(item.draft_id!)}
            onSettle={onSettle}
            onRetry={() => setRetrying((r) => new Set(r).add(item.draft_id!))}
          />
        ))}
      </ul>

      {finished.length > 0 && (
        <p className="text-[13px] text-muted">
          {finished.length} finished piece{finished.length === 1 ? "" : "s"} cost ${actualUsd.toFixed(2)},
          against ${quotedUsd.toFixed(2)} quoted.
        </p>
      )}

      <ConfirmDialog
        open={confirmSchedule}
        onClose={() => setConfirmSchedule(false)}
        onConfirm={scheduleEmails}
        loading={scheduling}
        title={`Schedule ${approvedEmails.length} email${approvedEmails.length === 1 ? "" : "s"}?`}
        description={`Each goes to your MailerLite audience at 10:00 on its planned day: ${approvedEmails
          .map((i) => dayLabel(i.date))
          .join(", ")}. You can still cancel a send in MailerLite before it goes out.`}
        confirmLabel="Schedule them"
      />
    </section>
  );
}

function PieceCard({
  item,
  status,
  generation,
  error,
  active,
  onSettle,
  onRetry,
}: {
  item: FactoryPlanItem;
  status: DraftStatusSummary | undefined;
  generation: "generating" | "ready" | "error";
  error?: string;
  active: boolean;
  onSettle: SettleFn;
  onRetry: () => void;
}) {
  const format = getCampaignFormat(item.format);
  const state = status?.state;
  const badge =
    generation === "error"
      ? { tone: "danger" as const, text: "Failed" }
      : generation === "generating"
        ? { tone: "neutral" as const, text: active ? "Making" : "Queued" }
        : state === "approved"
          ? { tone: "success" as const, text: "Approved" }
          : state === "rejected" || state === "superseded"
            ? { tone: "neutral" as const, text: "Replaced" }
            : { tone: "warning" as const, text: "Needs review" };

  return (
    <li>
      <Card className="flex h-full flex-col overflow-hidden">
        <div
          className={cn(
            "w-full bg-surface-2",
            item.kind === "ad" ? "aspect-square" : item.kind === "social" ? "aspect-[4/5]" : "aspect-[16/9]",
          )}
        >
          {status?.imageUrl && generation === "ready" && (
            // Supabase Storage URL; next/image would need remotePatterns for it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={status.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={KIND_TONE[item.kind]}>{format?.label ?? FACTORY_KIND_LABELS[item.kind]}</Badge>
            <Badge tone={badge.tone}>{badge.text}</Badge>
            <span className="text-[12px] text-muted">{dayLabel(item.date)}</span>
          </div>
          <p className="text-[14px] font-medium text-foreground">
            {status?.subject || item.title}
          </p>
          {active && generation === "generating" && item.draft_id && (
            <PieceProgress draftId={item.draft_id} onSettle={onSettle} />
          )}
          {generation === "error" && (
            <div className="space-y-2">
              <p className="text-[13px] text-danger">{error ?? "Generation failed."}</p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}
          {generation === "ready" && (
            <>
              {status && status.qaIssues > 0 && (
                <p className="text-[12px] text-warning">
                  {status.qaIssues} quality note{status.qaIssues === 1 ? "" : "s"} to check
                </p>
              )}
              <p className="text-[12px] text-muted">{whereItGoes(item)}</p>
              <span className="flex-1" />
              <Link
                href={`/drafts/${item.draft_id}`}
                className="text-[13px] font-medium text-accent hover:text-accent-press"
              >
                Open and review
              </Link>
            </>
          )}
        </div>
      </Card>
    </li>
  );
}

/** Mounted only while a piece is in the active slots, so at most three
 * generation streams are open at once. */
function PieceProgress({
  draftId,
  onSettle,
}: {
  draftId: string;
  onSettle: SettleFn;
}) {
  const stream = useGenerationStream(draftId);
  const notified = useRef(false);
  useEffect(() => {
    if (notified.current) return;
    if (stream.status === "ready" || stream.status === "error") {
      notified.current = true;
      onSettle(draftId, stream.status, stream.error);
    }
  }, [stream.status, stream.error, draftId, onSettle]);
  return <p className="text-[13px] text-muted">{stream.label}…</p>;
}
