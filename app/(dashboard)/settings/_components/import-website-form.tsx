"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AccentSpinner, Button, Card, Field, Input, useToast } from "@/components/ui";
import type { Brand, BrandImportProposal, Product } from "@/lib/db/types";
import { ImportReview } from "../../_components/import-review";

// Settings entry point for the website importer: URL in, proposal out, then
// the shared ImportReview handles edit + explicit save.

export function ImportWebsiteForm({
  brand,
  products,
  onSaved,
}: {
  brand: Brand;
  products: Product[];
  onSaved?: () => void;
}) {
  const [url, setUrl] = useState(brand.visual_identity?.footer?.website ?? "");
  const [importing, setImporting] = useState(false);
  const [proposal, setProposal] = useState<BrandImportProposal | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function handleImport() {
    if (!url.trim()) return;
    setImporting(true);
    try {
      const res = await fetch("/api/settings/import-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as {
        proposal?: BrandImportProposal;
        error?: string;
      };
      if (!res.ok || !data.proposal) {
        throw new Error(data.error ?? "Import failed. Try again.");
      }
      setProposal(data.proposal);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed. Try again.");
    } finally {
      setImporting(false);
    }
  }

  if (proposal) {
    return (
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
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-muted">
        Point it at your website and it pulls how you sound, what you offer,
        and how you look into a proposal you review before anything is saved.
      </p>
      <Field label="Website URL">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleImport()}
          placeholder="yourbrand.com"
          disabled={importing}
        />
      </Field>
      {importing && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <AccentSpinner />
          Reading your website, this can take up to a minute…
        </div>
      )}
      <Button
        variant="gradient"
        loading={importing}
        disabled={!url.trim()}
        onClick={handleImport}
      >
        Scan website
      </Button>
    </Card>
  );
}
