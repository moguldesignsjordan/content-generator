"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";

interface TopicOption {
  id: string;
  title: string;
  pillarName: string;
}

export function QuickGenerate({ topics }: { topics: TopicOption[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const STATUSES = [
    "Analyzing your brand voice",
    "Understanding your audience",
    "Crafting the subject line",
    "Writing the email body",
    "Applying tone and style",
    "Running quality checks",
    "Almost ready",
  ];

  async function generate() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setStatusIdx(0);

    const interval = setInterval(() => {
      setStatusIdx((i) => (i + 1) % STATUSES.length);
    }, 5000);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: selectedId }),
      });
      const data = (await res.json()) as { draftId?: string; error?: string };
      clearInterval(interval);
      if (!res.ok) throw new Error(data.error ?? "Generation failed.");
      router.push(`/drafts/${data.draftId}`);
    } catch (err) {
      clearInterval(interval);
      setError(err instanceof Error ? err.message : "Generation failed.");
      setBusy(false);
    }
  }

  const selectedTopic = topics.find((t) => t.id === selectedId);
  const grouped = groupByPillar(topics);

  return (
    <>
      {busy && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-8 text-center">
            <PenAnimation />
            <p className="mt-5 text-[15px] font-medium text-foreground">
              {selectedTopic?.title}
            </p>
            <p className="mt-2 text-[13px] text-muted">
              {STATUSES[statusIdx]}
              <ThinkingDots />
            </p>
            <div className="mt-5 h-px w-full bg-border" />
            <p className="mt-3 text-[12px] text-muted-2">
              This takes 30 to 90 seconds
            </p>
          </Card>
        </div>
      )}

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
            New draft
          </p>
          <Badge tone="cyan">Email</Badge>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={busy}
            className="h-11 flex-1 rounded-[var(--radius-md)] border border-border bg-surface-2 px-3.5 text-[15px] text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
          >
            <option value="">Pick a topic…</option>
            {grouped.map(([pillar, ts]) => (
              <optgroup key={pillar} label={pillar}>
                {ts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button
            variant="gradient"
            size="md"
            onClick={generate}
            disabled={!selectedId || busy}
            className="sm:w-auto"
          >
            Generate
          </Button>
        </div>

        {error && <p className="mt-2.5 text-xs text-danger">{error}</p>}
      </Card>
    </>
  );
}

function groupByPillar(topics: TopicOption[]): [string, TopicOption[]][] {
  const map = new Map<string, TopicOption[]>();
  for (const t of topics) {
    const arr = map.get(t.pillarName) ?? [];
    arr.push(t);
    map.set(t.pillarName, arr);
  }
  return Array.from(map.entries());
}

function ThinkingDots() {
  return (
    <span className="ml-1 inline-flex gap-0.5 align-middle">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1 w-1 animate-bounce rounded-full bg-muted"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function PenAnimation() {
  return (
    <div className="relative mx-auto flex h-14 w-14 items-center justify-center">
      <span className="absolute inset-0 animate-ping rounded-full bg-accent/10" />
      <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-accent/15">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 animate-pulse text-accent"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </span>
    </div>
  );
}
