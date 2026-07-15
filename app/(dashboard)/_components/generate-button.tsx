"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toastApiError } from "@/lib/billing/toast-error";
import { Button, useToast } from "@/components/ui";
import { BoltIcon } from "@/components/ui/icons";

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

  return (
    <Button
      variant="subtle"
      size="sm"
      onClick={generate}
      loading={busy}
      disabled={busy}
    >
      <BoltIcon size={14} />
      {busy ? "Generating…" : "Generate"}
    </Button>
  );
}
