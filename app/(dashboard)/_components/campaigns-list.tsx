"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  SegmentedControl,
  Spinner,
  useToast,
} from "@/components/ui";
import { ArchiveIcon, ChevronRightIcon, TrashIcon, UnarchiveIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { CampaignSummary } from "@/lib/db/types";
import { KIND_ART } from "./art";
import { CampaignStatusBadge } from "./topic-badges";

type Filter = "all" | "active" | "done" | "archived";

/**
 * The Campaigns list: every campaign, newest-updated first, with its send
 * progress and an expandable row to jump straight into any of its series
 * emails without a separate detail page.
 */
export function CampaignsList({ campaigns: initialCampaigns }: { campaigns: CampaignSummary[] }) {
  const router = useRouter();
  const toast = useToast();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  async function handleArchive(campaignId: string, archive: boolean) {
    setActingId(campaignId);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/archive`, {
        method: archive ? "POST" : "DELETE",
      });
      if (!res.ok) throw new Error();
      setCampaigns((cs) =>
        cs.map((c) => (c.id === campaignId ? { ...c, archived: archive } : c)),
      );
      if (archive && expanded === campaignId) setExpanded(null);
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
      const res = await fetch(`/api/campaigns/${confirmDeleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to delete campaign.");
      }
      setCampaigns((cs) => cs.filter((c) => c.id !== confirmDeleteId));
      if (expanded === confirmDeleteId) setExpanded(null);
      toast.success("Campaign deleted.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete campaign.");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  // Archived campaigns are hidden from all/active/done (tucked away by
  // design); the Archived tab is the only place they show.
  const active = campaigns.filter((c) => !c.archived);
  const counts = {
    all: active.length,
    active: active.filter((c) => c.status !== "done").length,
    done: active.filter((c) => c.status === "done").length,
    archived: campaigns.filter((c) => c.archived).length,
  };
  const filtered =
    filter === "archived"
      ? campaigns.filter((c) => c.archived)
      : filter === "all"
        ? active
        : filter === "done"
          ? active.filter((c) => c.status === "done")
          : active.filter((c) => c.status !== "done");

  if (campaigns.length === 0) {
    return (
      <EmptyState
        art={KIND_ART.campaign}
        title="No campaigns yet"
        action={
          <LinkButton href="/?mode=campaign" variant="outline" size="sm">
            Plan a campaign
          </LinkButton>
        }
      >
        A campaign is a full set of posts, emails and ads around one goal. Describe it once and
        you get a plan to edit before anything is made.
      </EmptyState>
    );
  }

  return (
    <div>
      <SegmentedControl
        className="mb-5"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={[
          { value: "all", label: `All ${counts.all}` },
          { value: "active", label: `Active ${counts.active}` },
          { value: "done", label: `Done ${counts.done}` },
          ...(counts.archived > 0
            ? [{ value: "archived" as const, label: `Archived ${counts.archived}` }]
            : []),
        ]}
      />

      {filtered.length === 0 ? (
        <Card className="p-7 text-center">
          <p className="text-sm text-muted">Nothing here in this state yet.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const series = c.chat_state?.series ?? [];
            const isOpen = expanded === c.id;
            const title = c.brief.goal?.trim() || "Untitled campaign";
            const factory = c.chat_state?.factory;
            const subtitleParts = [
              factory
                ? `${factory.plan?.length ?? 0} pieces`
                : `${c.emails} email${c.emails === 1 ? "" : "s"}`,
              c.sent > 0 ? `${c.sent} sent` : null,
              c.scheduled > 0 ? `${c.scheduled} scheduled` : null,
            ].filter(Boolean);

            return (
              <Card
                key={c.id}
                className={cn(
                  "overflow-hidden transition-colors hover:border-border-strong",
                  c.archived && "opacity-60",
                )}
              >
                <div className="flex items-start gap-1 p-1.5 pr-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-[var(--radius-md)] p-2.5 text-left transition-colors hover:bg-surface-2/60 active:bg-surface-3"
                  >
                    <ChevronRightIcon
                      size={16}
                      className={cn(
                        "mt-1 shrink-0 text-muted-2 transition-transform",
                        isOpen && "rotate-90",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CampaignStatusBadge status={c.status} />
                        <span className="text-[12px] tabular-nums text-muted-2">
                          {new Date(c.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="mt-1.5 line-clamp-2 font-display text-[17px] font-semibold leading-snug text-foreground">
                        {title}
                      </div>
                      <div className="mt-1 text-[13px] text-muted">
                        {subtitleParts.join(" · ")}
                      </div>
                      {c.emails > 0 && (
                        <SendProgress emails={c.emails} sent={c.sent} scheduled={c.scheduled} />
                      )}
                    </div>
                  </button>
                  <RowIconButton
                    label={c.archived ? "Unarchive campaign" : "Archive campaign"}
                    loading={actingId === c.id}
                    disabled={!!actingId}
                    className="mt-1"
                    onClick={() => handleArchive(c.id, !c.archived)}
                  >
                    {c.archived ? <UnarchiveIcon size={18} /> : <ArchiveIcon size={18} />}
                  </RowIconButton>
                  <RowIconButton
                    label="Delete campaign"
                    danger
                    className="mt-1"
                    onClick={() => setConfirmDeleteId(c.id)}
                  >
                    <TrashIcon size={18} />
                  </RowIconButton>
                </div>

                {isOpen && (
                  <div className="border-t border-border bg-surface-2/40 px-4 py-2">
                    {factory ? (
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="block py-2 text-[13.5px] font-medium text-accent hover:text-accent-press"
                      >
                        Open the plan and pieces
                      </Link>
                    ) : series.length > 0 ? (
                      <div className="divide-y divide-border">
                        {series.map((item, i) => (
                          <Link
                            key={item.draft_id}
                            href={`/drafts/${item.draft_id}`}
                            className="group flex items-center gap-3 py-2 text-[13.5px]"
                          >
                            <span className="w-5 shrink-0 text-right tabular-nums text-muted-2">
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-accent">
                              {item.title}
                            </span>
                            {item.email_type && (
                              <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] capitalize text-muted">
                                {item.email_type}
                              </span>
                            )}
                            <span className="shrink-0 text-[12px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                              Open
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="py-2 text-[13px] text-muted">
                        No emails yet.{" "}
                        <Link
                          href="/?mode=campaign"
                          className="font-medium text-accent hover:text-accent-press"
                        >
                          Start a new campaign
                        </Link>{" "}
                        to make one.
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this campaign?"
        description="This removes the campaign and its chat thread. Emails already created stay in Emails, just no longer grouped under this campaign. This can't be undone."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}

/** How many of a campaign's emails went out (green) or are booked (cyan). */
function SendProgress({
  emails,
  sent,
  scheduled,
}: {
  emails: number;
  sent: number;
  scheduled: number;
}) {
  return (
    <div
      role="img"
      aria-label={`${sent} of ${emails} emails sent, ${scheduled} scheduled`}
      className="mt-3 flex h-1.5 max-w-xs overflow-hidden rounded-full bg-surface-3"
    >
      <span className="bg-success" style={{ width: `${(sent / emails) * 100}%` }} />
      <span className="bg-cyan" style={{ width: `${(scheduled / emails) * 100}%` }} />
    </div>
  );
}

function RowIconButton({
  label,
  onClick,
  disabled,
  loading,
  danger,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  className?: string;
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
        className,
      )}
    >
      {loading ? <Spinner size={16} /> : children}
    </button>
  );
}
