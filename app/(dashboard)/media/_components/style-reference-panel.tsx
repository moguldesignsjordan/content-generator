"use client";

import { useRef, useState } from "react";
import { Button, Card, ConfirmDialog, Field, Input, useToast } from "@/components/ui";
import type { StyleReference, StyleReferenceKind } from "@/lib/db/types";

const COPY: Record<
  StyleReferenceKind,
  { namePlaceholder: string; imageHint: string; usedLabel: string; emptyHint: string }
> = {
  flyer: {
    namePlaceholder: "e.g. Bold gradient, Minimal editorial…",
    imageHint: "A flyer or design whose LOOK new flyers can borrow.",
    usedLabel: "Available for new flyers",
    emptyHint: "Upload a flyer or design you like. New flyers can match its look.",
  },
  email: {
    namePlaceholder: "e.g. The clean one from Everlane",
    imageHint: "A screenshot of an email whose LAYOUT you want recreated.",
    usedLabel: "Used on new emails",
    emptyHint: "Upload a screenshot of an email whose look you want. Your emails will copy its layout, with your own colors and words.",
  },
};

/**
 * Pure library management (upload/list/delete) for one style_references kind
 * (migrations 014+016), used by the Media page's Flyer Styles / Email
 * Designs tabs. Unlike StylePicker (flyers/_components/style-library.tsx),
 * there's no "current selection" here — this page isn't mid-generation, it's
 * just where the library lives. Doesn't replace StylePicker or
 * EmailDesignsForm at their existing call sites (flyer creation, Settings).
 */
export function StyleReferencePanel({
  kind,
  initialItems,
}: {
  kind: StyleReferenceKind;
  initialItems: StyleReference[];
}) {
  const copy = COPY[kind];
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handlePick(picked: File) {
    if (!picked.type.startsWith("image/")) {
      toast.error("Pick an image file.");
      return;
    }
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
    if (!name) setName(picked.name.replace(/\.[^.]+$/, ""));
  }

  async function handleSave() {
    if (!file || !name.trim() || saving) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("name", name.trim());
      body.append("kind", kind);
      const res = await fetch("/api/style-references", { method: "POST", body });
      const data = (await res.json()) as { style?: StyleReference; error?: string };
      if (!res.ok || !data.style) throw new Error(data.error ?? "Upload failed.");
      setItems((prev) => [data.style!, ...prev]);
      setName("");
      setFile(null);
      setPreview(null);
      toast.success("Saved to your style library.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/style-references/${confirmDeleteId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((s) => s.id !== confirmDeleteId));
      toast.success("Removed.");
    } catch {
      toast.error("Failed to remove.");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={copy.namePlaceholder}
            maxLength={60}
          />
        </Field>
        <Field label="Reference image" hint={copy.imageHint}>
          {preview ? (
            <div className="overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Preview" className="max-h-56 w-full object-contain" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted transition hover:border-foreground/30 hover:text-foreground"
            >
              Tap to pick an image
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
            Save style
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            {file ? "Pick another" : "Choose image"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) handlePick(picked);
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted">{copy.emptyHint}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <Card key={item.id} className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-foreground">
                    {item.name}
                  </p>
                  <p className="text-xs text-muted">
                    {kind === "email" && i === 0 ? copy.usedLabel : "Saved"} ·{" "}
                    {new Date(item.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDeleteId(item.id)}
                >
                  Remove
                </Button>
              </div>
              {item.design_profile?.summary && (
                <p className="text-sm leading-relaxed text-muted">
                  {item.design_profile.summary}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this style?"
        description="Content already generated with it keeps its look; you just can't pick it again."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}
