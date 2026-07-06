"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Checkbox, useToast } from "@/components/ui";
import { FunnelBadge, KeywordBadge } from "./topic-badges";
import type { TopicIdeaInput } from "@/prompts/suggest-topics";
import type { KeywordData } from "@/lib/db/types";

// "Suggest topic ideas" on the Create tab: proposals come from the brand
// brain, the user picks which to add (nothing persists until Add selected).

type Proposal = TopicIdeaInput & { include: boolean; keywordData?: KeywordData };

export function SuggestTopics({ compact = false }: { compact?: boolean }) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [researchingIndex, setResearchingIndex] = useState<number | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function handleResearch(i: number) {
    const proposal = proposals?.[i];
    if (!proposal?.target_keyword) return;
    setResearchingIndex(i);
    try {
      const res = await fetch("/api/keywords/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: proposal.target_keyword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        keywordData?: KeywordData;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Keyword research failed.");
      setProposals((prev) =>
        prev
          ? prev.map((p, pi) => (pi === i ? { ...p, keywordData: data.keywordData } : p))
          : prev,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Keyword research failed.");
    } finally {
      setResearchingIndex(null);
    }
  }

  async function handleSuggest() {
    setLoading(true);
    try {
      const res = await fetch("/api/topics/suggest", { method: "POST" });
      const data = (await res.json()) as {
        proposals?: TopicIdeaInput[];
        error?: string;
      };
      if (!res.ok || !data.proposals?.length) {
        throw new Error(data.error ?? "No ideas came back. Try again.");
      }
      setProposals(data.proposals.map((p) => ({ ...p, include: true })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    const picked = proposals?.filter((p) => p.include) ?? [];
    if (!picked.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/topics/suggest", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topics: picked.map(({ include: _include, keywordData: _keywordData, ...t }) => t),
        }),
      });
      if (!res.ok) throw new Error();
      const count = picked.length;
      setProposals(null);
      toast.success(`Added ${count} topic${count === 1 ? "" : "s"} to your plan.`);
      router.refresh();
    } catch {
      toast.error("Couldn't add the topics. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!proposals) {
    return (
      <div className={compact ? "" : "text-center"}>
        <Button
          variant={compact ? "subtle" : "gradient"}
          size={compact ? "sm" : undefined}
          loading={loading}
          onClick={handleSuggest}
        >
          {loading ? "Thinking…" : "✨ Suggest topic ideas"}
        </Button>
      </div>
    );
  }

  const pickedCount = proposals.filter((p) => p.include).length;

  return (
    <Card className="space-y-3 p-5">
      <p className="text-[13px] text-muted">
        Ideas from your brand brain. Uncheck any you don&apos;t want, then add
        them to your plan.
      </p>
      <div className="space-y-2">
        {proposals.map((p, i) => (
          <label
            key={i}
            className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-border p-3 transition-colors hover:bg-surface-2"
          >
            <Checkbox
              checked={p.include}
              onChange={(e) =>
                setProposals(
                  proposals.map((x, xi) =>
                    xi === i ? { ...x, include: e.target.checked } : x,
                  ),
                )
              }
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="block text-[14.5px] font-medium text-foreground">
                {p.title}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                {p.funnel_stage && <FunnelBadge stage={p.funnel_stage} />}
                {p.target_keyword && <span>“{p.target_keyword}”</span>}
                {p.target_keyword &&
                  (p.keywordData?.primary ? (
                    <KeywordBadge data={p.keywordData.primary} />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleResearch(i);
                      }}
                      disabled={researchingIndex === i}
                      className="font-medium text-accent transition-colors hover:text-accent-press disabled:opacity-50"
                    >
                      {researchingIndex === i ? "Researching…" : "Research"}
                    </button>
                  ))}
                {p.maps_to_product && <span>sells: {p.maps_to_product}</span>}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="gradient"
          loading={saving}
          disabled={!pickedCount}
          onClick={handleAdd}
        >
          Add {pickedCount} to plan
        </Button>
        <Button variant="subtle" disabled={saving} onClick={() => setProposals(null)}>
          Discard
        </Button>
      </div>
    </Card>
  );
}
