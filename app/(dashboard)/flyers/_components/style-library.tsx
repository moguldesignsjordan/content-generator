"use client";

import { useRef, useState } from "react";
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  Sheet,
  Spinner,
  useToast,
} from "@/components/ui";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export interface StyleOption {
  id: string;
  name: string;
  imageUrl: string;
}

/**
 * The reusable style library, rendered as the flyer form's style picker:
 * saved reference images as selectable swatches, plus add (upload once, reuse
 * everywhere) and delete. Owns its list state so adds/deletes reflect
 * instantly without a server round-trip re-render.
 */
export function StylePicker({
  initialStyles,
  value,
  onChange,
  disabled,
}: {
  initialStyles: StyleOption[];
  value: string;
  onChange: (styleId: string) => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [styles, setStyles] = useState(initialStyles);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleAdd() {
    if (!file || !name.trim() || saving) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("name", name.trim());
      const res = await fetch("/api/style-references", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        style?: { id: string; name: string; image_url: string };
        error?: string;
      };
      if (!res.ok || !data.style) throw new Error(data.error ?? "Upload failed.");
      const added: StyleOption = {
        id: data.style.id,
        name: data.style.name,
        imageUrl: data.style.image_url,
      };
      setStyles((prev) => [added, ...prev]);
      onChange(added.id);
      setAddOpen(false);
      setName("");
      setFile(null);
      toast.success("Style saved to your library.");
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
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to delete.");
      }
      setStyles((prev) => prev.filter((s) => s.id !== confirmDeleteId));
      if (value === confirmDeleteId) onChange("");
      toast.success("Style deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Swatch
          selected={value === ""}
          name="No style"
          hint="Brand colors only"
          onClick={() => onChange("")}
          disabled={disabled}
        />
        {styles.map((s) => (
          <Swatch
            key={s.id}
            selected={value === s.id}
            name={s.name}
            imageUrl={s.imageUrl}
            onClick={() => onChange(s.id)}
            onDelete={() => setConfirmDeleteId(s.id)}
            disabled={disabled}
          />
        ))}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          disabled={disabled}
          className="flex h-[104px] w-[104px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-muted transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
        >
          <PlusIcon size={18} />
          <span className="text-[12px] font-medium">Add style</span>
        </button>
      </div>

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a style"
        description="Upload a flyer or design you like. New flyers can match its look."
        footer={
          <div className="flex gap-2">
            <Button variant="subtle" className="flex-1" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              className="flex-1"
              loading={saving}
              disabled={!file || !name.trim()}
              onClick={handleAdd}
            >
              Save style
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Style name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bold gradient, Minimal editorial…"
              maxLength={60}
            />
          </Field>
          <Field label="Reference image" hint="JPEG, PNG, or WebP, up to 10MB.">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-surface-3 file:px-4 file:py-2 file:text-[13px] file:font-medium file:text-foreground hover:file:bg-surface-2"
            />
          </Field>
          {file && (
            <div className="overflow-hidden rounded-xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(file)}
                alt="Style preview"
                className="max-h-56 w-full object-cover"
              />
            </div>
          )}
          {saving && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner size={14} /> Uploading…
            </p>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this style?"
        description="Flyers already generated with it keep their look; you just can't pick it for new ones."
        confirmLabel="Delete"
        loading={deleting}
      />
    </>
  );
}

function Swatch({
  selected,
  name,
  hint,
  imageUrl,
  onClick,
  onDelete,
  disabled,
}: {
  selected: boolean;
  name: string;
  hint?: string;
  imageUrl?: string;
  onClick: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        className={cn(
          "flex w-[104px] flex-col overflow-hidden rounded-xl border text-left transition-colors disabled:opacity-50",
          selected
            ? "border-accent ring-1 ring-accent"
            : "border-border hover:border-foreground/30",
        )}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="h-[72px] w-full object-cover" />
        ) : (
          <div className="flex h-[72px] w-full items-center justify-center bg-surface-2 px-2 text-center text-[11px] text-muted">
            {hint ?? "Brand only"}
          </div>
        )}
        <span className="truncate px-2 py-1.5 text-[12px] font-medium">{name}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete style ${name}`}
          onClick={onDelete}
          disabled={disabled}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-sm transition-colors hover:text-danger disabled:opacity-50"
        >
          <CloseIcon size={11} />
        </button>
      )}
    </div>
  );
}
