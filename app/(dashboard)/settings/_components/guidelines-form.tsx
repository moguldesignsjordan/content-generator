"use client";

import { useState } from "react";
import { Button, Card, useToast } from "@/components/ui";
import type { BrandGuidelines } from "@/lib/db/types";
import {
  GuidelinesFields,
  applyGuidelinesProposal,
  guidelinesValueFromBrand,
  guidelinesValueToPayload,
} from "./guidelines-fields";

interface GuidelinesFormProps {
  brandId: string;
  guidelines: BrandGuidelines;
}

/**
 * Brand guidelines: synthesized by AI from everything stored, but the human
 * edits and explicitly saves. Generate only fills the fields (a proposal);
 * Save is the single write path and stamps approved_at server-side. The
 * seven editable fields themselves live in guidelines-fields.tsx, shared with
 * the brand-guidelines document route's own "not generated yet" state.
 */
export function GuidelinesForm({ brandId, guidelines }: GuidelinesFormProps) {
  const [value, setValue] = useState(() => guidelinesValueFromBrand(guidelines));
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposed, setProposed] = useState(false);
  const toast = useToast();

  const approvedAt = guidelines.approved_at
    ? new Date(guidelines.approved_at).toLocaleDateString()
    : null;
  const hasContent = Boolean(value.voiceAndTone || value.messagingPillars.length);

  async function handleGenerate() {
    setGenerating(true);
    setProposed(false);
    try {
      const res = await fetch("/api/settings/guidelines", { method: "POST" });
      const data = (await res.json()) as {
        proposal?: BrandGuidelines;
        error?: string;
      };
      if (!res.ok || !data.proposal) throw new Error(data.error);
      setValue((v) => applyGuidelinesProposal(v, data.proposal!));
      setProposed(true);
    } catch {
      toast.error("Couldn't generate a draft.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setProposed(false);
    try {
      const res = await fetch("/api/settings/guidelines", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          guidelines: guidelinesValueToPayload(value),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Saved and approved.");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-muted">
          {approvedAt
            ? `Approved ${approvedAt}. These guidelines lead every generation prompt.`
            : "Not approved yet. Generate a draft from everything stored, edit it, then save."}
        </p>
        <Button
          variant="subtle"
          size="sm"
          loading={generating}
          onClick={handleGenerate}
        >
          ✨ {hasContent ? "Regenerate" : "Generate"}
        </Button>
      </div>
      {proposed && (
        <p className="text-xs text-muted">
          Draft filled in below. Nothing is saved until you hit Save.
        </p>
      )}

      <GuidelinesFields value={value} onChange={setValue} />

      <div className="flex items-center gap-3 pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save guidelines
        </Button>
      </div>
    </Card>
  );
}
