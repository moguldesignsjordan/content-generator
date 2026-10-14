"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DraftStatusSummary } from "@/lib/db/queries";
import { FACTORY_KIND_LABELS } from "@/prompts/campaign-formats";
import { KIND_TONE } from "../../_components/kind-tone";

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
  const ready = items.filter((i) => statuses[i.id]?.generation === "ready");

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
    <div className="space-y-4">
      {ready.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            {ready.length} ready. Open any to edit, or approve them all at once.
          </p>
          <Button variant="gradient" loading={approving} onClick={approveAll}>
            Approve all {ready.length}
          </Button>
        </Card>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const status = statuses[item.id];
          const kind = status?.kind ?? "email";
          const generating = !status || status.generation === "generating";
          return (
            <li key={item.id}>
              <Link href={`/drafts/${item.id}`} className="block h-full">
                <Card className="flex h-full flex-col overflow-hidden transition-colors hover:border-foreground/20">
                  <div
                    className={cn(
                      "w-full bg-surface-2",
                      kind === "ad" ? "aspect-square" : kind === "social" ? "aspect-[4/5]" : "aspect-[16/9]",
                    )}
                  >
                    {status?.imageUrl && (
                      // Supabase Storage URL; next/image would need remotePatterns for it.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={status.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND_TONE[kind]}>{FACTORY_KIND_LABELS[kind]}</Badge>
                      {generating ? (
                        <Badge tone="neutral">Being made</Badge>
                      ) : status.generation === "error" ? (
                        <Badge tone="danger">Failed</Badge>
                      ) : (
                        <Badge tone="warning">Needs review</Badge>
                      )}
                    </div>
                    <p className="text-[14px] font-medium text-foreground">
                      {status?.subject || item.title}
                    </p>
                    {status && status.qaIssues > 0 && (
                      <p className="text-[12px] text-warning">
                        {status.qaIssues} quality note{status.qaIssues === 1 ? "" : "s"} to check
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
