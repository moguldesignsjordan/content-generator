"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, SegmentedControl, useToast } from "@/components/ui";
import type { SegmentedOption } from "@/components/ui";
import type {
  BrandColors,
  BrandFonts,
  BrandGuidelines,
  VisualIdentity,
} from "@/lib/db/types";
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

function hasAnyColor(vi: VisualIdentity): boolean {
  return Boolean(vi.colors && Object.values(vi.colors).some(Boolean));
}

export function BrandGuidelinesView({
  brandId,
  brandName,
  guidelines,
  visualIdentity,
  documents,
}: {
  brandId: string;
  brandName: string;
  guidelines: BrandGuidelines;
  visualIdentity: VisualIdentity;
  documents: Record<BrandBookTemplateId, string>;
}) {
  if (!guidelines.approved_at) {
    return (
      <NotGeneratedYet
        brandId={brandId}
        guidelines={guidelines}
        visualIdentity={visualIdentity}
      />
    );
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

interface IdentityProposal {
  colors: BrandColors;
  fonts: BrandFonts;
  reasoning: string;
}

/**
 * The single Generate action here does double duty for a brand with no
 * colors set yet: it also runs the from-scratch palette+font generator
 * (same /api/settings/brand-identity call the old standalone "Generate
 * brand identity" Settings action used) so a brand-new brand gets a
 * complete document in one step. Brands that already have colors skip that
 * call entirely, nothing regenerates a palette that's already set.
 */
function NotGeneratedYet({
  brandId,
  guidelines,
  visualIdentity,
}: {
  brandId: string;
  guidelines: BrandGuidelines;
  visualIdentity: VisualIdentity;
}) {
  const [value, setValue] = useState(() => guidelinesValueFromBrand(guidelines));
  const [identityProposal, setIdentityProposal] = useState<IdentityProposal | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposed, setProposed] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const hasContent = Boolean(value.voiceAndTone || value.messagingPillars.length);
  const needsIdentity = !hasAnyColor(visualIdentity);

  async function handleGenerate() {
    setGenerating(true);
    setProposed(false);
    try {
      const guidelinesPromise = fetch("/api/settings/guidelines", { method: "POST" });
      // Best-effort: a failure here shouldn't sink the guidelines draft.
      const identityPromise = needsIdentity
        ? fetch("/api/settings/brand-identity", { method: "POST" }).catch(() => null)
        : Promise.resolve(null);

      const [guidelinesRes, identityRes] = await Promise.all([
        guidelinesPromise,
        identityPromise,
      ]);

      const guidelinesData = (await guidelinesRes.json()) as {
        proposal?: BrandGuidelines;
        error?: string;
      };
      if (!guidelinesRes.ok || !guidelinesData.proposal) {
        throw new Error(guidelinesData.error);
      }
      setValue((v) => applyGuidelinesProposal(v, guidelinesData.proposal!));

      if (identityRes?.ok) {
        const identityData = (await identityRes.json()) as {
          proposal?: { visual_identity?: { colors?: BrandColors; fonts?: BrandFonts } };
          reasoning?: string;
        };
        const colors = identityData.proposal?.visual_identity?.colors;
        if (colors) {
          setIdentityProposal({
            colors,
            fonts: identityData.proposal?.visual_identity?.fonts ?? {},
            reasoning: identityData.reasoning ?? "",
          });
        }
      }

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
      const requests = [
        fetch("/api/settings/guidelines", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId, guidelines: guidelinesValueToPayload(value) }),
        }),
      ];
      if (identityProposal) {
        requests.push(
          fetch("/api/settings/visual-identity", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              brandId,
              visualIdentity: {
                ...visualIdentity,
                colors: identityProposal.colors,
                fonts: identityProposal.fonts,
              },
            }),
          }),
        );
      }
      const results = await Promise.all(requests);
      if (results.some((r) => !r.ok)) throw new Error();
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
          colors, and type.
          {needsIdentity
            ? " No colors set yet, generating will also pick a starting palette and font pairing."
            : ""}{" "}
          Review and edit before saving, nothing here becomes the document until
          you approve it.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="subtle" size="sm" loading={generating} onClick={handleGenerate}>
          ✨ {hasContent ? "Regenerate" : "Generate"}
        </Button>
        {proposed && <p className="text-xs text-muted">Draft filled in below.</p>}
      </div>

      {identityProposal && (
        <div className="rounded-[var(--radius-md)] border border-border bg-surface-2 p-4">
          <p className="mb-3 text-[13px] font-medium text-foreground">
            Proposed colors &amp; fonts
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(identityProposal.colors).map(([role, hex]) =>
              hex ? (
                <div
                  key={role}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs"
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-border"
                    style={{ background: hex }}
                  />
                  <span className="capitalize text-muted">{role}</span>
                </div>
              ) : null,
            )}
          </div>
          {identityProposal.reasoning && (
            <p className="mt-3 text-xs text-muted">{identityProposal.reasoning}</p>
          )}
        </div>
      )}

      <GuidelinesFields value={value} onChange={setValue} />

      <div className="pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save and view document
        </Button>
      </div>
    </Card>
  );
}
