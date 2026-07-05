"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AccentSpinner, Button, Card, useToast } from "@/components/ui";
import type { Brand, BrandImportProposal, Product } from "@/lib/db/types";
import { ImportReview } from "../../_components/import-review";

// From-scratch visual identity for brands with no website to import from:
// one cheap call picks a color palette + font pairing, reviewed and saved
// through the same ImportReview flow as the website importer.

export function GenerateIdentityForm({
  brand,
  products,
  onSaved,
}: {
  brand: Brand;
  products: Product[];
  onSaved?: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [proposal, setProposal] = useState<BrandImportProposal | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/settings/brand-identity", { method: "POST" });
      const data = (await res.json()) as {
        proposal?: BrandImportProposal;
        reasoning?: string;
        error?: string;
      };
      if (!res.ok || !data.proposal) {
        throw new Error(data.error ?? "Couldn't generate an identity. Try again.");
      }
      setProposal(data.proposal);
      setReasoning(data.reasoning ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Try again.");
    } finally {
      setGenerating(false);
    }
  }

  if (proposal) {
    return (
      <div className="space-y-4">
        {reasoning && (
          <p className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px] text-muted">
            {reasoning}
          </p>
        )}
        <ImportReview
          brandId={brand.id}
          brandName={brand.name}
          currentVoice={brand.voice_profile ?? {}}
          currentPositioning={brand.positioning ?? {}}
          currentVisual={brand.visual_identity ?? {}}
          existingProducts={products}
          proposal={proposal}
          onDone={(saved) => {
            setProposal(null);
            if (saved.length) {
              router.refresh();
              onSaved?.();
            }
          }}
        />
      </div>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-muted">
        No website to pull from? Generate a starting color palette and font
        pairing from your brand name and voice. You'll review it before
        anything is saved, and can always refine it by hand afterward.
      </p>
      {generating && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <AccentSpinner />
          Picking a palette…
        </div>
      )}
      <Button variant="gradient" loading={generating} onClick={handleGenerate}>
        Generate brand identity
      </Button>
    </Card>
  );
}
