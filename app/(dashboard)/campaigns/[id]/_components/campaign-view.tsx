"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Textarea, useToast } from "@/components/ui";
import { ApiError, type ApiErrorBody, toastApiError } from "@/lib/billing/toast-error";
import { ScreenHeader } from "../../../_components/screen-header";
import type {
  FactoryFinding,
  FactoryPlanItem,
  FactoryResearch,
  FactoryState,
} from "@/lib/db/types";
import {
  FACTORY_KINDS,
  FACTORY_KIND_LABELS,
  getCampaignFormat,
} from "@/prompts/campaign-formats";
import type { DraftStatusSummary } from "@/lib/db/queries";
import { KIND_TONE } from "../../../_components/kind-tone";
import { PiecesSection } from "./pieces-section";
import { slugify } from "@/lib/text";

// One factory campaign: the research it was built on, the plan table (edit,
// fill in real details, remove rows), and the quote with "test 3 first" or
// "generate all". Launched pieces move to the progress and review section,
// and the calendar lists every piece by day.

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function CampaignView({
  campaignId,
  initial,
  statuses,
  brandId,
  unsavedProducts,
}: {
  campaignId: string;
  initial: FactoryState;
  statuses: Record<string, DraftStatusSummary>;
  brandId: string;
  /** Product names this plan covers that aren't saved yet, with the photo given. */
  unsavedProducts: { name: string; photo?: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [factory, setFactory] = useState<FactoryState>(initial);
  const [launching, setLaunching] = useState<"test" | "all" | null>(null);
  const plan = factory.plan ?? [];
  const pending = plan.filter((i) => !i.draft_id);
  const launched = plan.filter((i) => i.draft_id);

  async function patch(body: { edits?: Record<string, Partial<FactoryPlanItem>>; remove?: string[] }) {
    const res = await fetch(`/api/factory/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<FactoryState> & { error?: string };
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't save the plan.");
      return;
    }
    setFactory((f) => ({ ...f, plan: data.plan, quote: data.quote }));
  }

  async function launch(mode: "test" | "all") {
    setLaunching(mode);
    try {
      const res = await fetch(`/api/factory/${campaignId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<FactoryState> &
        ApiErrorBody & { created?: number };
      if (!res.ok) throw new ApiError(data.error ?? "Couldn't start generating.", data);
      setFactory((f) => ({ ...f, plan: data.plan, quote: data.quote }));
      toast.success(`Started ${data.created} piece${data.created === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (e) {
      toastApiError(toast, e instanceof ApiError ? e : null, "Couldn't start generating.");
    } finally {
      setLaunching(null);
    }
  }

  return (
    <div className="space-y-6">
      <ScreenHeader
        title={factory.sentence}
        subtitle={`${plan.length} pieces over ${factory.days} days${
          factory.planning_usd ? `. Research and planning cost ${usd(factory.planning_usd)}.` : "."
        }`}
      />

      {launched.length > 0 && factory.quote && (
        <PiecesSection
          campaignId={campaignId}
          items={launched}
          statuses={statuses}
          unitUsd={factory.quote.unit_usd}
        />
      )}

      {unsavedProducts.length > 0 && (
        <SaveProductsOffer campaignId={campaignId} brandId={brandId} products={unsavedProducts} />
      )}

      {factory.research && <ResearchCard research={factory.research} />}

      {pending.length > 0 && (
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-semibold">The plan</h2>
            <p className="text-[14px] text-muted">
              Edit anything, remove what you don&apos;t want, and fill in real details where asked.
              Nothing is made until you start it below.
            </p>
          </div>
          {FACTORY_KINDS.filter((k) => pending.some((i) => i.kind === k)).map((kind) => (
            <div key={kind} className="space-y-3">
              <h3 className="text-[13px] font-medium uppercase tracking-wider text-muted">
                {FACTORY_KIND_LABELS[kind]} ({pending.filter((i) => i.kind === kind).length})
              </h3>
              <ul className="space-y-3">
                {pending
                  .filter((i) => i.kind === kind)
                  .map((item) => (
                    <PlanRow
                      key={item.id}
                      item={item}
                      onSave={(edit) => patch({ edits: { [item.id]: edit } })}
                      onRemove={() => patch({ remove: [item.id] })}
                    />
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {factory.quote && pending.length > 0 && (
        <Card className="space-y-4 p-5">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold">Ready to make it?</h2>
            <p className="text-[14px] text-muted">
              Start with a test of {factory.quote.test.count} (one of each kind) to check the quality
              before spending on the rest.{" "}
              {FACTORY_KINDS.some((k) => factory.quote!.from_history[k])
                ? "Prices are based on what your recent drafts cost."
                : "Prices are estimates until you have a few drafts."}
            </p>
          </div>
          {pending.some((i) => i.needs_detail && !i.detail) && (
            <p className="text-[13px] text-warning">
              {pending.filter((i) => i.needs_detail && !i.detail).length} pieces still need a real
              detail. They&apos;ll be written without invented numbers, but they&apos;re stronger with one.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="gradient"
              loading={launching === "test"}
              disabled={launching !== null || factory.quote.test.count === 0}
              onClick={() => launch("test")}
            >
              Test {factory.quote.test.count} first, {usd(factory.quote.test.usd)} (
              {factory.quote.test.credits} credits)
            </Button>
            <Button
              variant="outline"
              loading={launching === "all"}
              disabled={launching !== null}
              onClick={() => launch("all")}
            >
              Make all {factory.quote.all.count}, {usd(factory.quote.all.usd)} (
              {factory.quote.all.credits} credits)
            </Button>
          </div>
        </Card>
      )}

      {plan.length > 0 && <Calendar plan={plan} statuses={statuses} />}
    </div>
  );
}

function Calendar({
  plan,
  statuses,
}: {
  plan: FactoryPlanItem[];
  statuses: Record<string, DraftStatusSummary>;
}) {
  const label = (item: FactoryPlanItem) => {
    const status = item.draft_id ? statuses[item.draft_id] : undefined;
    if (!item.draft_id) return "Planned";
    if (!status || status.generation === "generating") return "Being made";
    if (status.generation === "error") return "Failed";
    return status.state === "approved" ? "Approved" : "Needs review";
  };
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold">Calendar</h2>
      <ul className="mt-3 divide-y divide-border">
        {[...plan]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[14px]">
              <span className="w-24 shrink-0 tabular-nums text-muted">{dayLabel(item.date)}</span>
              <Badge tone={KIND_TONE[item.kind]}>{FACTORY_KIND_LABELS[item.kind]}</Badge>
              <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
              <span className="text-[13px] text-muted">{label(item)}</span>
            </li>
          ))}
      </ul>
    </Card>
  );
}

/** Offers once, in one tap, to save a per-product plan's typed products as
 * the brand's products. Never saves on its own. */
function SaveProductsOffer({
  campaignId,
  brandId,
  products,
}: {
  campaignId: string;
  brandId: string;
  products: { name: string; photo?: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const key = `save-products-offer:${campaignId}`;
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(key)) setHidden(true);
    } catch {
      // Storage blocked: the offer just shows again next visit.
    }
  }, [key]);

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Same as above.
    }
  }

  async function save() {
    setSaving(true);
    let saved = 0;
    for (const p of products) {
      const res = await fetch("/api/settings/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          product: { slug: slugify(p.name), name: p.name, ...(p.photo ? { image_url: p.photo } : {}) },
        }),
      }).catch(() => null);
      if (res?.ok) saved++;
    }
    setSaving(false);
    if (saved < products.length) {
      toast.error(`Saved ${saved} of ${products.length}. Try again.`);
      return;
    }
    toast.success("Saved to your products.");
    dismiss();
    router.refresh();
  }

  if (hidden) return null;
  const names = products.map((p) => p.name);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <p className="flex-1 text-[14px] text-foreground">
        Save {list} as your products? Next time they&apos;re one tap away
        {products.some((p) => p.photo) ? ", with the photos you gave" : ""}.
      </p>
      <div className="flex gap-2">
        <Button variant="gradient" size="sm" loading={saving} onClick={() => void save()}>
          Save them
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </Card>
  );
}

function SourceLinks({ sources }: { sources: string[] }) {
  if (!sources.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-x-2 text-[12px]">
      {sources.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:text-accent-press"
        >
          {host(url)}
        </a>
      ))}
    </span>
  );
}

function FindingList({ title, items }: { title: string; items: FactoryFinding[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
      <ul className="space-y-1.5 text-[14px] text-muted">
        {items.map((f, i) => (
          <li key={i}>
            {f.point}
            <SourceLinks sources={f.sources} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResearchCard({ research }: { research: FactoryResearch }) {
  return (
    <Card className="p-5">
      <details>
        <summary className="cursor-pointer list-none space-y-1">
          <span className="flex items-center justify-between gap-3">
            <span className="font-display text-lg font-semibold">What the research found</span>
            <span className="text-[13px] text-accent">Show</span>
          </span>
          {research.summary && <p className="text-[14px] text-muted">{research.summary}</p>}
        </summary>
        <div className="mt-4 space-y-4">
          <FindingList title="Working right now" items={research.trends} />
          <FindingList title="What competitors do" items={research.competitor_patterns} />
          {research.hook_patterns.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-[13px] font-medium text-foreground">Hooks that stop the scroll</h3>
              <ul className="list-disc space-y-1 pl-5 text-[14px] text-muted">
                {research.hook_patterns.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          <FindingList title="Real facts about you" items={research.brand_facts} />
        </div>
      </details>
    </Card>
  );
}

function PlanRow({
  item,
  onSave,
  onRemove,
}: {
  item: FactoryPlanItem;
  onSave: (edit: Partial<FactoryPlanItem>) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [hook, setHook] = useState(item.hook);
  const [date, setDate] = useState(item.date);
  const [detail, setDetail] = useState(item.detail ?? "");
  const [removing, setRemoving] = useState(false);
  const format = getCampaignFormat(item.format);

  // The detail can be cleared; title, hook, and date can't be blanked.
  const saveIfChanged = (field: "title" | "hook" | "date" | "detail", value: string, current?: string) => {
    if (value === (current ?? "")) return;
    if (field !== "detail" && !value.trim()) return;
    void onSave({ [field]: value });
  };

  return (
    <li>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={KIND_TONE[item.kind]}>{format?.label ?? item.kind}</Badge>
          {item.product && <Badge>{item.product}</Badge>}
          <span className="text-[13px] text-muted">{dayLabel(date)}</span>
          {item.needs_detail && !detail && <Badge tone="warning">Needs a real detail</Badge>}
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            loading={removing}
            onClick={async () => {
              setRemoving(true);
              await onRemove();
              setRemoving(false);
            }}
          >
            Remove
          </Button>
        </div>

        <Input
          id={`title-${item.id}`}
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => saveIfChanged("title", title, item.title)}
          className="font-medium"
        />
        <Textarea
          id={`hook-${item.id}`}
          aria-label="Hook"
          rows={2}
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          onBlur={() => saveIfChanged("hook", hook, item.hook)}
        />
        {item.core_idea && (
          <p className="text-[14px] text-muted">
            <span className="font-medium text-foreground">Idea: </span>
            {item.core_idea}
          </p>
        )}
        {item.preview && (
          <p className="text-[14px] text-muted">
            <span className="font-medium text-foreground">
              {item.kind === "email" ? "Subject: " : item.kind === "blog" ? "Title: " : "Caption: "}
            </span>
            {item.preview}
          </p>
        )}
        {item.visual && (
          <p className="text-[14px] text-muted">
            <span className="font-medium text-foreground">Picture: </span>
            {item.visual}
          </p>
        )}

        {item.needs_detail && (
          <Input
            id={`detail-${item.id}`}
            aria-label="Real detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onBlur={() => saveIfChanged("detail", detail, item.detail)}
            placeholder={item.detail_prompt || "Add a real number, result, or customer quote"}
          />
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
          <label className="flex items-center gap-2">
            Date
            <input
              id={`date-${item.id}`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onBlur={() => saveIfChanged("date", date, item.date)}
              className="rounded-[var(--radius-sm)] border border-border bg-surface-2 px-2 py-1 text-foreground"
            />
          </label>
          {item.inspired_by && (
            <span>
              Inspired by{" "}
              <a
                href={item.inspired_by}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-accent-press"
              >
                {host(item.inspired_by)}
              </a>
            </span>
          )}
        </div>
      </Card>
    </li>
  );
}
