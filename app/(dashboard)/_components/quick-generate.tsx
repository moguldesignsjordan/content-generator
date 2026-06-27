"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      {/* Full-screen generation overlay */}
      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center">
            <PenAnimation />
            <p className="mt-5 text-sm font-medium text-foreground">
              {selectedTopic?.title}
            </p>
            <p className="mt-2 text-xs text-muted">
              {STATUSES[statusIdx]}
              <ThinkingDots />
            </p>
            <div className="mt-5 h-px w-full bg-border" />
            <p className="mt-3 text-xs text-muted opacity-50">
              This takes 30–90 seconds
            </p>
          </div>
        </div>
      )}

      {/* Card */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            New draft
          </p>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
            Email
          </span>
        </div>

        <div className="flex gap-3">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={busy}
            className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
          >
            <option value="">Pick a topic&hellip;</option>
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
          <button
            onClick={generate}
            disabled={!selectedId || busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Generate
          </button>
        </div>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
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
    <span className="inline-flex gap-0.5 align-middle">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-muted animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function PenAnimation() {
  return (
    <div className="relative mx-auto flex h-14 w-14 items-center justify-center">
      {/* Outer pulse ring */}
      <span className="absolute inset-0 rounded-full bg-accent/10 animate-ping" />
      {/* Icon */}
      <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-accent/15">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 text-accent animate-pulse"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </span>
    </div>
  );
}
