"use client";

import { useState } from "react";
import { Button, Card, Field, Input, Textarea, useToast } from "@/components/ui";
import type { Positioning } from "@/lib/db/types";
import { ListInput } from "./list-input";
import { SuggestButton } from "./suggest-button";

interface PositioningFormProps {
  brandId: string;
  positioning: Positioning;
}

export function PositioningForm({ brandId, positioning }: PositioningFormProps) {
  // Guard: a brand row seeded before these columns existed returns undefined.
  const p = positioning ?? {};
  const [description, setDescription] = useState(
    p.business_description ?? "",
  );
  const [tagline, setTagline] = useState(p.tagline ?? "");
  const [differentiators, setDifferentiators] = useState(
    p.differentiators ?? [],
  );
  const [competitors, setCompetitors] = useState(p.competitors ?? []);

  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/positioning", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          positioning: {
            business_description: description.trim() || undefined,
            tagline: tagline.trim() || undefined,
            differentiators: differentiators.filter(Boolean),
            competitors: competitors.filter(Boolean),
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

  return (
    <Card className="space-y-5 p-5">
      <Field
        label="Business description"
        hint="2 to 3 sentences on what you do and for whom."
      >
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Mogul Design Agency builds brand identity systems for scaling startups…"
        />
        <div className="mt-2">
          <SuggestButton
            field="business_description"
            currentValue={description}
            onApply={setDescription}
          />
        </div>
      </Field>

      <Field label="Tagline" hint="One short line that captures the brand.">
        <Input
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="e.g. Brands that look as credible as they are."
        />
        <div className="mt-2">
          <SuggestButton
            field="tagline"
            currentValue={tagline}
            onApply={(v) => setTagline(v.split("\n")[0] ?? "")}
          />
        </div>
      </Field>

      <div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-foreground/90">
              Differentiators
            </p>
            <p className="mt-1 text-xs text-muted">
              What sets you apart, the things copy should lean on.
            </p>
          </div>
          <SuggestButton
            field="differentiators"
            currentValue={differentiators}
            onApply={(v) =>
              setDifferentiators((cur) => [
                ...cur,
                ...v.split("\n").map((s) => s.trim()).filter(Boolean),
              ])
            }
          />
        </div>
        <div className="mt-3">
          <ListInput
            label=""
            values={differentiators}
            onChange={setDifferentiators}
            multiline
            placeholder="Add a differentiator…"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-foreground/90">
              Competitors
            </p>
            <p className="mt-1 text-xs text-muted">
              Who you&apos;re up against. Copy differentiates; it doesn&apos;t
              name-call.
            </p>
          </div>
          <SuggestButton
            field="competitors"
            currentValue={competitors}
            onApply={(v) =>
              setCompetitors((cur) => [
                ...cur,
                ...v.split("\n").map((s) => s.trim()).filter(Boolean),
              ])
            }
          />
        </div>
        <div className="mt-3">
          <ListInput
            label=""
            values={competitors}
            onChange={setCompetitors}
            placeholder="Add a competitor…"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save positioning
        </Button>
      </div>
    </Card>
  );
}
