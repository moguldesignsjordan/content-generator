"use client";

import { useState } from "react";

interface FunnelFormProps {
  strategyId: string;
  funnelDefinition: Record<string, { cta_type: string }>;
}

export function FunnelForm({ strategyId, funnelDefinition }: FunnelFormProps) {
  const [awareness, setAwareness] = useState(
    funnelDefinition.awareness?.cta_type ?? "",
  );
  const [consideration, setConsideration] = useState(
    funnelDefinition.consideration?.cta_type ?? "",
  );
  const [decision, setDecision] = useState(
    funnelDefinition.decision?.cta_type ?? "",
  );

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch("/api/settings/funnel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId,
          funnelDefinition: {
            awareness: { cta_type: awareness.trim() },
            consideration: { cta_type: consideration.trim() },
            decision: { cta_type: decision.trim() },
          },
        }),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  const canSave = awareness.trim() && consideration.trim() && decision.trim();

  return (
    <div className="space-y-6 rounded-lg border border-border bg-surface p-6">
      <p className="text-xs text-muted">
        Each value must match a key in your CTA Library above (e.g.{" "}
        <code>newsletter_signup</code>, <code>portfolio</code>,{" "}
        <code>book_call</code>). This tells the engine which CTA to use when
        writing for each funnel stage.
      </p>

      <StageField
        stage="Awareness"
        value={awareness}
        onChange={setAwareness}
        placeholder="e.g. newsletter_signup"
      />
      <StageField
        stage="Consideration"
        value={consideration}
        onChange={setConsideration}
        placeholder="e.g. portfolio"
      />
      <StageField
        stage="Decision"
        value={decision}
        onChange={setDecision}
        placeholder="e.g. book_call"
      />

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save funnel config"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-emerald-400">Saved ✓</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-400">Failed to save.</span>
        )}
      </div>
    </div>
  );
}

function StageField({
  stage,
  value,
  onChange,
  placeholder,
}: {
  stage: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-muted">{stage}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none font-mono"
      />
    </div>
  );
}
