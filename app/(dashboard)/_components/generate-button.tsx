"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Triggers email generation for a topic, then navigates to the review screen.
// Shows a busy state during the 30–90s call and surfaces any error inline
// (Guardrail #5: never silently swallow a failure).
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
      <button
        onClick={generate}
        disabled={busy}
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Generating… (~30–90s)" : "Generate email"}
      </button>
      {error && <span className="max-w-[12rem] text-right text-xs text-red-400">{error}</span>}
    </div>
  );
}
