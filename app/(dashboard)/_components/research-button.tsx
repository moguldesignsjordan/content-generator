"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";

// Explicit, per-topic trigger for DataForSEO keyword research (Slice 4
// "enrich" cut). No auto-spend: this is the only thing that calls DataForSEO.
export function ResearchButton({ topicId }: { topicId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function research() {
    setBusy(true);
    try {
      const res = await fetch(`/api/topics/${topicId}/research`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Keyword research failed.");
      toast.success("Keyword data updated.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Keyword research failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={research}
      disabled={busy}
      className="text-[13px] text-muted transition-colors hover:text-foreground disabled:opacity-50"
    >
      {busy ? "Researching…" : "Research"}
    </button>
  );
}
