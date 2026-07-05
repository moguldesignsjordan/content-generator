"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Select, useToast } from "@/components/ui";

interface TopicOption {
  id: string;
  title: string;
  pillarName: string;
}

export function QuickGenerate({ topics }: { topics: TopicOption[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function generate() {
    if (!selectedId) return;
    setBusy(true);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: selectedId }),
      });
      const data = (await res.json()) as { draftId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Generation failed.");
      router.push(`/drafts/${data.draftId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
      setBusy(false);
    }
  }

  const grouped = groupByPillar(topics);

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
          New draft
        </p>
        <Badge tone="cyan">Email</Badge>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={busy}
          className="flex-1"
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
        </Select>
        <Button
          variant="gradient"
          size="md"
          onClick={generate}
          loading={busy}
          disabled={!selectedId || busy}
          className="sm:w-auto"
        >
          Generate
        </Button>
      </div>
    </Card>
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
