"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AccentSpinner, Button, Card, Field, Input } from "@/components/ui";
import type { BrandImportProposal } from "@/lib/db/types";
import { ImportReview } from "../../_components/import-review";

/**
 * First-run: no brand exists yet. Create one (name + optional website). With
 * a website, the importer pre-fills the brand brain from the real site. With
 * no website, a cheap brand-identity generation step still gets the brand a
 * real color palette and font pairing instead of leaving visual_identity
 * empty (silently falling back to generic defaults in every email). Either
 * way the user reviews the proposal before the onboarding chat starts; the
 * chat's system prompt already carries the current profile, so it only asks
 * about gaps.
 */
export function CreateBrandForm() {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [generatingIdentity, setGeneratingIdentity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [review, setReview] = useState<{
    brandId: string;
    proposal: BrandImportProposal;
  } | null>(null);
  const router = useRouter();

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json().catch(() => ({}))) as { id?: string };

      if (website.trim() && data.id) {
        setSaving(false);
        setImporting(true);
        try {
          const imp = await fetch("/api/settings/import-website", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: website.trim() }),
          });
          const impData = (await imp.json()) as {
            proposal?: BrandImportProposal;
          };
          if (imp.ok && impData.proposal) {
            setReview({ brandId: data.id, proposal: impData.proposal });
            return;
          }
          setImportNote(
            "Couldn't import from your site, the chat will ask instead.",
          );
        } catch {
          setImportNote(
            "Couldn't import from your site, the chat will ask instead.",
          );
        } finally {
          setImporting(false);
        }
      } else if (data.id) {
        // No website: still get a real palette instead of generic defaults.
        // Cheap and fast (FAST_MODEL, no thinking), so worth doing inline.
        setSaving(false);
        setGeneratingIdentity(true);
        try {
          const gen = await fetch("/api/settings/brand-identity", { method: "POST" });
          const genData = (await gen.json()) as { proposal?: BrandImportProposal };
          if (gen.ok && genData.proposal) {
            setReview({ brandId: data.id, proposal: genData.proposal });
            return;
          }
        } catch {
          // Silent: this is a nice-to-have for a brand-new profile, not
          // worth blocking onboarding over if generation hiccups.
        } finally {
          setGeneratingIdentity(false);
        }
      }
      router.refresh();
    } catch {
      setError("Couldn't create the brand. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (review) {
    return (
      <ImportReview
        brandId={review.brandId}
        brandName={name.trim()}
        // Brand-new brand: nothing stored yet, so empty current values are safe.
        currentVoice={{}}
        currentPositioning={{}}
        currentVisual={{}}
        existingProducts={[]}
        proposal={review.proposal}
        onDone={() => router.refresh()}
      />
    );
  }

  if (importing) {
    return (
      <Card className="flex items-center gap-3 p-6 text-sm text-muted">
        <AccentSpinner />
        Reading {website.trim().replace(/^https?:\/\//, "")}, this can take up
        to a minute…
      </Card>
    );
  }

  if (generatingIdentity) {
    return (
      <Card className="flex items-center gap-3 p-6 text-sm text-muted">
        <AccentSpinner />
        Picking a starting color palette and font pairing…
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="font-display text-lg font-semibold">Start your brand profile</h2>
      <p className="mt-1.5 text-sm text-muted">
        You&apos;ll walk through the basics, then how your brand looks and sounds.
        Everything is editable later in Settings.
      </p>
      <div className="mt-5 space-y-4">
        <Field label="Brand name">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mogul Design Agency"
          />
        </Field>
        <Field
          label="Website (optional)"
          hint="With one, we pull your real voice and visuals. Without one, you'll still get a generated starting palette to refine."
        >
          <Input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="yourbrand.com"
          />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {importNote && <p className="mt-2 text-sm text-muted">{importNote}</p>}
      <Button
        variant="gradient"
        className="mt-5"
        loading={saving}
        disabled={!name.trim()}
        onClick={handleCreate}
      >
        {saving ? "Creating…" : "Start onboarding"}
      </Button>
    </Card>
  );
}
