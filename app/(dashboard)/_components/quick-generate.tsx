"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toastApiError } from "@/lib/billing/toast-error";
import { Badge, Button, Card, Select, useToast } from "@/components/ui";
import type { EmailType } from "@/lib/db/types";

// Same override options as CreateAgent's brief card; this surface is
// email-only so there's no blog_type equivalent here.
const EMAIL_TYPE_OPTIONS: { value: EmailType; label: string }[] = [
  { value: "newsletter", label: "Newsletter" },
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
  { value: "promotional", label: "Promotional" },
  { value: "announcement", label: "Announcement" },
];

interface TopicOption {
  id: string;
  title: string;
  pillarName: string;
}

export function QuickGenerate({ topics }: { topics: TopicOption[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState("");
  const [emailType, setEmailType] = useState<EmailType | "">("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function generate() {
    if (!selectedId) return;
    setBusy(true);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: selectedId,
          emailType: emailType || undefined,
        }),
      });
      const data = (await res.json()) as {
        draftId?: string;
        error?: string;
        outOfCredits?: boolean;
        upgradeUrl?: string;
      };
      if (!res.ok) {
        toastApiError(toast, data, "Generation failed.");
        setBusy(false);
        return;
      }
      router.push(`/drafts/${data.draftId}`);
    } catch {
      toast.error("Generation failed.");
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
        <Select
          value={emailType}
          onChange={(e) => setEmailType(e.target.value as EmailType | "")}
          disabled={busy}
          className="sm:w-40"
          aria-label="Email type override"
        >
          <option value="">Auto type</option>
          {EMAIL_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
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
