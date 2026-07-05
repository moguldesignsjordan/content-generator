"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { SparkleIcon } from "@/components/ui/icons";

// Triggers email generation for a topic, then navigates to the review screen.
export function GenerateButton({ topicId }: { topicId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function generate() {
    setBusy(true);
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
      toast.error(err instanceof Error ? err.message : "Generation failed.");
      setBusy(false);
    }
  }

  return (
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
  );
}
