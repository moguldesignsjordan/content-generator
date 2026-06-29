"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { SparkleIcon } from "@/components/ui/icons";

// Triggers email generation for a topic, then navigates to the review screen.
// Shows a busy state during the 30 to 90s call and surfaces any error inline.
export function GenerateButton({ topicId }: { topicId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Generation failed.");
      router.push(`/drafts/${data.draftId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="subtle"
        size="sm"
        onClick={generate}
        loading={busy}
        disabled={busy}
      >
        <SparkleIcon size={14} />
        {busy ? "Generating…" : "Generate"}
      </Button>
      {error && (
        <span className="max-w-[12rem] text-right text-[11px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
