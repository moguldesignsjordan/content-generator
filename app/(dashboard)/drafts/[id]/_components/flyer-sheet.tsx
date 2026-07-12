"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Field,
  Input,
  SegmentedControl,
  Select,
  Sheet,
  Textarea,
  useToast,
} from "@/components/ui";
import type { ContentImage, FlyerAspect, FlyerCopy } from "@/lib/db/types";

const ASPECT_OPTIONS: { value: FlyerAspect; label: string }[] = [
  { value: "1:1", label: "Square 1:1" },
  { value: "4:5", label: "Portrait 4:5" },
  { value: "9:16", label: "Story 9:16" },
];

interface StyleRow {
  id: string;
  name: string;
  image_url: string;
}

interface FlyerSheetProps {
  open: boolean;
  onClose: () => void;
  draftId: string;
  copy: FlyerCopy | null;
  aspect: FlyerAspect;
  /** The prompt behind the current render, for the exact-prompt editor. */
  promptUsed?: string;
  styleReferenceId?: string;
  onApplied: (image: ContentImage, copy: FlyerCopy | null, aspect: FlyerAspect) => void;
}

type Tab = "design" | "upload";

/**
 * The flyer edit sheet, sibling of image-sheet.tsx: tweak the on-image text,
 * post shape, or saved style and re-render (one Gemini call, no Claude), edit
 * the exact prompt for full control, or replace the design with an uploaded
 * image. Caption edits live on the review card, not here.
 */
export function FlyerSheet({
  open,
  onClose,
  draftId,
  copy,
  aspect: initialAspect,
  promptUsed,
  styleReferenceId,
  onApplied,
}: FlyerSheetProps) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("design");

  const [headline, setHeadline] = useState(copy?.headline ?? "");
  const [subtext, setSubtext] = useState(copy?.subtext ?? "");
  const [cta, setCta] = useState(copy?.cta ?? "");
  const [aspect, setAspect] = useState<FlyerAspect>(initialAspect);
  const [styleId, setStyleId] = useState(styleReferenceId ?? "");
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [exactPrompt, setExactPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchedStyles = useRef(false);

  // Re-seed the fields each time the sheet opens (the draft may have changed).
  useEffect(() => {
    if (!open) return;
    setHeadline(copy?.headline ?? "");
    setSubtext(copy?.subtext ?? "");
    setCta(copy?.cta ?? "");
    setAspect(initialAspect);
    setStyleId(styleReferenceId ?? "");
    setExactPrompt("");
    setShowPrompt(false);
    setFile(null);
    if (!fetchedStyles.current) {
      fetchedStyles.current = true;
      fetch("/api/style-references")
        .then((r) => r.json())
        .then((d: { styles?: StyleRow[] }) => setStyles(d.styles ?? []))
        .catch(() => {});
    }
  }, [open, copy, initialAspect, styleReferenceId]);

  async function submit(form: FormData, failMessage: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/flyer`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        image?: ContentImage;
        copy?: FlyerCopy;
        aspect?: FlyerAspect;
        error?: string;
      };
      if (!res.ok || !data.image) throw new Error(data.error ?? failMessage);
      onApplied(data.image, data.copy ?? copy, data.aspect ?? aspect);
      toast.success("Flyer updated.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failMessage);
    } finally {
      setBusy(false);
    }
  }

  function handleRegenerate() {
    const form = new FormData();
    form.set("mode", "generate");
    form.set("headline", headline);
    form.set("subtext", subtext);
    form.set("cta", cta);
    form.set("aspect", aspect);
    form.set("styleReferenceId", styleId || "none");
    if (showPrompt && exactPrompt.trim()) {
      form.set("exactPrompt", exactPrompt.trim());
    }
    void submit(form, "Couldn't regenerate the flyer.");
  }

  function handleUpload() {
    if (!file) return;
    const form = new FormData();
    form.set("mode", "upload");
    form.set("file", file);
    form.set("aspect", aspect);
    void submit(form, "Couldn't upload the image.");
  }

  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Edit flyer design"
      description="Regenerating costs one image render; text edits and uploads are free."
      footer={
        <div className="flex gap-2">
          <Button variant="subtle" className="flex-1" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {tab === "design" ? (
            <Button
              variant="gradient"
              className="flex-1"
              loading={busy}
              disabled={!headline.trim()}
              onClick={handleRegenerate}
            >
              Regenerate design
            </Button>
          ) : (
            <Button
              variant="gradient"
              className="flex-1"
              loading={busy}
              disabled={!file}
              onClick={handleUpload}
            >
              Use this image
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: "design", label: "Regenerate" },
            { value: "upload", label: "Upload my own" },
          ]}
        />

        {tab === "design" ? (
          <>
            <Field label="Headline" hint="Rendered in the image, exactly as written.">
              <Input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={80}
                disabled={busy}
              />
            </Field>
            <Field label="Supporting line (optional)">
              <Input
                value={subtext}
                onChange={(e) => setSubtext(e.target.value)}
                maxLength={100}
                disabled={busy}
              />
            </Field>
            <Field label="Call to action (optional)">
              <Input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                maxLength={40}
                disabled={busy}
              />
            </Field>
            <Field label="Post shape">
              <SegmentedControl
                value={aspect}
                onChange={(v) => setAspect(v as FlyerAspect)}
                options={ASPECT_OPTIONS}
                size="sm"
              />
            </Field>
            {styles.length > 0 && (
              <Field label="Style">
                <Select
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">No style (brand colors only)</option>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div>
              <button
                type="button"
                onClick={() => {
                  setShowPrompt((v) => !v);
                  if (!showPrompt && !exactPrompt) setExactPrompt(promptUsed ?? "");
                }}
                className="text-[13px] font-medium text-accent transition-colors hover:text-accent-press"
              >
                {showPrompt ? "Hide the full prompt" : "Edit the full prompt instead"}
              </button>
              {showPrompt && (
                <Field
                  className="mt-2"
                  hint="Sent to the image model exactly as written; the fields above are ignored for the visuals (the headline still names the draft)."
                >
                  <Textarea
                    rows={7}
                    value={exactPrompt}
                    onChange={(e) => setExactPrompt(e.target.value)}
                    disabled={busy}
                  />
                </Field>
              )}
            </div>
          </>
        ) : (
          <>
            <Field
              label="Your image"
              hint="JPEG, PNG, or WebP up to 10MB. It gets fitted to the post shape."
            >
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-surface-3 file:px-4 file:py-2 file:text-[13px] file:font-medium file:text-foreground hover:file:bg-surface-2"
              />
            </Field>
            <Field label="Post shape">
              <SegmentedControl
                value={aspect}
                onChange={(v) => setAspect(v as FlyerAspect)}
                options={ASPECT_OPTIONS}
                size="sm"
              />
            </Field>
            {file && (
              <div className="overflow-hidden rounded-xl border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(file)}
                  alt="Upload preview"
                  className="max-h-64 w-full object-cover"
                />
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
