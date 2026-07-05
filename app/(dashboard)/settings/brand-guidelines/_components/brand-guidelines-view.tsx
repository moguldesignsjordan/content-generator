"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, SegmentedControl, useToast } from "@/components/ui";
import type { SegmentedOption } from "@/components/ui";
import type { BrandGuidelines } from "@/lib/db/types";
import type { BrandBookTemplateId } from "@/lib/brand-book/types";
import {
  GuidelinesFields,
  applyGuidelinesProposal,
  guidelinesValueFromBrand,
  guidelinesValueToPayload,
} from "../../_components/guidelines-fields";

const VARIANT_OPTIONS: SegmentedOption<BrandBookTemplateId>[] = [
  { value: "bold_spectrum", label: "Bold Spectrum" },
  { value: "clean_minimal", label: "Clean Minimal" },
];

export function BrandGuidelinesView({
  brandId,
  brandName,
  guidelines,
  documents,
}: {
  brandId: string;
  brandName: string;
  guidelines: BrandGuidelines;
  documents: Record<BrandBookTemplateId, string>;
}) {
  if (!guidelines.approved_at) {
    return <NotGeneratedYet brandId={brandId} guidelines={guidelines} />;
  }
  return <GeneratedDocument brandName={brandName} documents={documents} />;
}

function GeneratedDocument({
  brandName,
  documents,
}: {
  brandName: string;
  documents: Record<BrandBookTemplateId, string>;
}) {
  const [variant, setVariant] = useState<BrandBookTemplateId>("bold_spectrum");

  function handleDownload() {
    const filename = `${brandName.replace(/[^\w.-]+/g, "_").slice(0, 80)}-brand-guidelines.html`;
    const blob = new Blob([documents[variant]], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl value={variant} onChange={setVariant} options={VARIANT_OPTIONS} />
        <Button variant="subtle" size="sm" onClick={handleDownload}>
          Download .html
        </Button>
      </div>
      <Card className="overflow-hidden p-0">
        <iframe
          key={variant}
          srcDoc={documents[variant]}
          title="Brand guidelines preview"
          className="h-[80vh] w-full border-0"
        />
      </Card>
    </div>
  );
}

function NotGeneratedYet({
  brandId,
  guidelines,
}: {
  brandId: string;
  guidelines: BrandGuidelines;
}) {
  const [value, setValue] = useState(() => guidelinesValueFromBrand(guidelines));
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposed, setProposed] = useState(false);
  const toast = useToast();
  const router = useRouter();
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
      toast.success("Saved. Building your document…");
      router.refresh();
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="font-display text-lg font-semibold">
          Generate your brand guidelines
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Synthesized from everything stored about your brand: voice, positioning,
          colors, and type. Review and edit before saving, nothing here becomes
          the document until you approve it.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="subtle" size="sm" loading={generating} onClick={handleGenerate}>
          ✨ {hasContent ? "Regenerate" : "Generate"}
        </Button>
        {proposed && (
          <p className="text-xs text-muted">Draft filled in below.</p>
        )}
      </div>

      <GuidelinesFields value={value} onChange={setValue} />

      <div className="pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save and view document
        </Button>
      </div>
    </Card>
  );
}
