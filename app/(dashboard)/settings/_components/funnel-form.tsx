"use client";

import { useState } from "react";
import { Button, Card, Field, Input, useToast } from "@/components/ui";

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
  const toast = useToast();

  async function handleSave() {
    setSaving(true);
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
      toast.success("Saved.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = awareness.trim() && consideration.trim() && decision.trim();

  return (
    <Card className="space-y-5 p-5">
      <p className="text-sm text-muted">
        Each value must match a key in your CTA Library (e.g.{" "}
        <code className="font-mono text-foreground/80">newsletter_signup</code>,{" "}
        <code className="font-mono text-foreground/80">portfolio</code>,{" "}
        <code className="font-mono text-foreground/80">book_call</code>). This
        tells the engine which CTA to use when writing for each funnel stage.
      </p>

      <StageField
        label="Awareness"
        value={awareness}
        onChange={setAwareness}
        placeholder="e.g. newsletter_signup"
      />
      <StageField
        label="Consideration"
        value={consideration}
        onChange={setConsideration}
        placeholder="e.g. portfolio"
      />
      <StageField
        label="Decision"
        value={decision}
        onChange={setDecision}
        placeholder="e.g. book_call"
      />

      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="gradient"
          loading={saving}
          disabled={!canSave}
          onClick={handleSave}
        >
          Save funnel config
        </Button>
      </div>
    </Card>
  );
}

function StageField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Field label={label}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-[13px]"
      />
    </Field>
  );
}
