"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Input, Spinner, useToast } from "@/components/ui";
import type { StyleReference } from "@/lib/db/types";

/**
 * The email design library (Settings → Email designs): upload a screenshot of
 * an email whose LOOK you want. Each upload runs a one-time design read; from
 * then on the newest design is attached to every email generation, which
 * rebuilds its layout with this brand's colors, fonts, and copy.
 *
 * The visual twin of ReferenceEmailsForm (which teaches how emails should
 * READ). Same shape, but the payload is an image, so it posts FormData to
 * /api/style-references with kind=email instead of JSON.
 *
 * UI copy stays non-technical on purpose: "design", "look", never "reference",
 * "profile", or "extraction".
 */
export function EmailDesignsForm() {
  const [designs, setDesigns] = useState<StyleReference[] | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/style-references?kind=email")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setDesigns(data.styles ?? []);
      })
      .catch(() => {
        if (!cancelled) setDesigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Object URLs are leaked memory until revoked; drop the old one on every swap
  // and on unmount.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handlePick(picked: File) {
    if (!picked.type.startsWith("image/")) {
      toast.error("Pick an image: a screenshot of the email works best.");
      return;
    }
    setFile(picked);
    if (!name) setName(picked.name.replace(/\.[^.]+$/, ""));
  }

  async function handleSave() {
    if (!file) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("name", name.trim());
      body.append("kind", "email");
      const res = await fetch("/api/style-references", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      setDesigns((list) => [data.style, ...(list ?? [])]);
      setName("");
      setFile(null);
      toast.success("Saved. New emails will copy this design.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/style-references/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDesigns((list) => (list ?? []).filter((d) => d.id !== id));
      toast.success("Removed.");
    } catch {
      toast.error("Failed to remove.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <Field
          label="Name"
          hint="What to call this design, e.g. 'The clean one from Everlane'."
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Big hero image, dark footer"
          />
        </Field>

        <Field
          label="The design"
          hint="A screenshot or picture of an email whose look you want. Your emails will copy its layout, with your own colors and words."
        >
          {preview ? (
            <div className="relative overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, no loader */}
              <img
                src={preview}
                alt="The design you picked"
                className="max-h-72 w-full object-contain"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted transition hover:border-foreground/30 hover:text-foreground"
            >
              Tap to pick a screenshot
            </button>
          )}
        </Field>

        <div className="flex items-center gap-3">
          <Button
            variant="gradient"
            loading={saving}
            disabled={!file || !name.trim()}
            onClick={handleSave}
          >
            {saving ? "Reading the design…" : "Save design"}
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            {file ? "Pick another" : "Choose image"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) handlePick(picked);
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      {designs === null ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : designs.length === 0 ? (
        <p className="px-1 text-sm text-muted">
          No designs yet. Add a screenshot of an email you love the look of, and
          your emails will start looking like it.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Newest first, and the newest is the one generation actually uses:
              say so, so an older design sitting below is never a mystery. */}
          {designs.map((design, i) => (
            <Card key={design.id} className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface">
                  {/* Plain img, like the flyer style library: these are Supabase
                      storage URLs and next.config declares no remotePatterns. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={design.image_url}
                    alt={design.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-foreground">
                    {design.name}
                  </p>
                  <p className="text-xs text-muted">
                    {i === 0 ? "Used on new emails" : "Saved"} ·{" "}
                    {new Date(design.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={deletingId === design.id}
                  onClick={() => handleDelete(design.id)}
                >
                  Remove
                </Button>
              </div>
              {design.design_profile?.summary && (
                <p className="text-sm leading-relaxed text-muted">
                  {design.design_profile.summary}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
