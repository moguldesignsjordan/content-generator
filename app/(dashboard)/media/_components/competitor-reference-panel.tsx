"use client";

import { useRef, useState } from "react";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  SegmentedControl,
  Textarea,
  useToast,
} from "@/components/ui";
import type { CompetitorReference } from "@/lib/db/types";

type InputMode = "text" | "image" | "url";

/**
 * The competitor ad swipe file (competitor_references, migration 025): save a
 * competitor ad you want to learn the STRATEGY from, never copy. Three input
 * paths land in the same table (see app/api/competitor-references/route.ts):
 * pasted copy, an uploaded screenshot, or a URL the server scrapes. Sibling of
 * StyleReferencePanel, but with three input modes instead of one image field.
 */
export function CompetitorReferencePanel({
  initialItems,
}: {
  initialItems: CompetitorReference[];
}) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [mode, setMode] = useState<InputMode>("text");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
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
  }

  function resetForm() {
    setName("");
    setContent("");
    setSourceUrl("");
    setFile(null);
    setPreview(null);
  }

  const canSave =
    !!name.trim() &&
    (mode === "text" ? !!content.trim() : mode === "image" ? !!file : !!sourceUrl.trim());

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append("name", name.trim());
      if (mode === "image" && file) {
        body.append("file", file);
      } else if (mode === "text") {
        body.append("content", content.trim());
      } else if (mode === "url") {
        body.append("source_url", sourceUrl.trim());
      }
      if (mode !== "url" && sourceUrl.trim()) body.append("source_url", sourceUrl.trim());

      const res = await fetch("/api/competitor-references", { method: "POST", body });
      const data = (await res.json()) as { reference?: CompetitorReference; error?: string };
      if (!res.ok || !data.reference) throw new Error(data.error ?? "Save failed.");
      setItems((prev) => [data.reference!, ...prev]);
      resetForm();
      toast.success("Saved to your competitor ad library.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/competitor-references/${confirmDeleteId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((r) => r.id !== confirmDeleteId));
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
        <p className="text-sm text-muted">
          Save a competitor ad to learn its strategy from, hook, angle, structure, CTA.
          Never copied verbatim: generation adapts the approach in your own words.
        </p>
        <SegmentedControl
          value={mode}
          onChange={(v) => {
            setMode(v);
            resetForm();
          }}
          options={[
            { value: "text", label: "Paste copy" },
            { value: "image", label: "Upload screenshot" },
            { value: "url", label: "Paste a URL" },
          ]}
        />
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme's Black Friday ad"
            maxLength={80}
          />
        </Field>

        {mode === "text" && (
          <Field label="Ad copy" hint="Paste the ad's text exactly as it reads.">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="Paste the ad copy here..."
            />
          </Field>
        )}

        {mode === "image" && (
          <Field label="Screenshot" hint="A screenshot of the ad, its copy is read automatically.">
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
            {preview && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => fileRef.current?.click()}
              >
                Pick another
              </Button>
            )}
          </Field>
        )}

        {mode === "url" && (
          <Field
            label="Ad URL"
            hint="We'll read the page's text. Login-walled pages (like Facebook Ad Library) can't be read this way; paste the copy or a screenshot instead."
          >
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
            />
          </Field>
        )}

        {mode !== "url" && (
          <Field label="Source URL (optional)">
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Where you saw it, if you have a link"
            />
          </Field>
        )}

        <Button variant="gradient" loading={saving} disabled={!canSave} onClick={handleSave}>
          Save competitor ad
        </Button>
      </Card>

      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted">
          Nothing here yet. Save a competitor ad you want to learn from, and it'll show up
          here to pick when creating a new email.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                {item.input_kind === "image" && item.image_url && (
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-foreground">
                    {item.name}
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(item.created_at).toLocaleDateString()}
                    {item.source_url ? ` · ${item.source_url}` : ""}
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
              {item.competitor_profile ? (
                <p className="text-sm leading-relaxed text-muted">
                  {item.competitor_profile.summary}
                </p>
              ) : (
                <p className="text-sm italic text-muted">
                  Strategy analysis wasn't available; the raw ad is still saved.
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
        title="Delete this competitor ad?"
        description="Emails already generated with it keep their content; you just can't pick it again."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}
