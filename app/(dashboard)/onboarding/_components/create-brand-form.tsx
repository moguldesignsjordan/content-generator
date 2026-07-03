"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AccentSpinner, Button, Card, Field, Input } from "@/components/ui";
import type { BrandImportProposal } from "@/lib/db/types";
import { ImportReview } from "../../_components/import-review";

/**
 * First-run: no brand exists yet. Create one (name + optional website). When
 * a website is given, the importer pre-fills the brand brain and the user
 * reviews the proposal before the onboarding chat starts; the chat's system
 * prompt already carries the current profile, so it only asks about gaps.
 */
export function CreateBrandForm() {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
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
        <Field label="Website (recommended)">
          <Input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="yourbrand.com — we'll pull your voice, offers, and visuals from it"
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
