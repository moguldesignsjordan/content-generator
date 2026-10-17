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
import { ApiError, type ApiErrorBody, toastApiError } from "@/lib/billing/toast-error";
import type { ContentImage, FlyerAspect, FlyerCopy } from "@/lib/db/types";
import { useImageModelOptions } from "../../../_components/image-models-context";

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

type Tab = "design" | "add" | "upload";

/**
 * The flyer edit sheet, sibling of image-sheet.tsx: tweak the on-image text,
 * post shape, or saved style and re-render (one Gemini call, no Claude), edit
 * the exact prompt for full control, add an image (into the design, or as a
 * style to copy), or replace the design with an uploaded image. Caption edits
 * live on the review card, not here.
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
  const [changeNote, setChangeNote] = useState("");
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [exactPrompt, setExactPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addRole, setAddRole] = useState<"place" | "style">("place");
  const [addNote, setAddNote] = useState("");
  const [busy, setBusy] = useState(false);
  // "" = the brand's default model (Settings).
  const imageModelOptions = useImageModelOptions();
  const [model, setModel] = useState("");
  const fetchedStyles = useRef(false);

  // Re-seed the fields each time the sheet opens (the draft may have changed).
  useEffect(() => {
    if (!open) return;
    setHeadline(copy?.headline ?? "");
    setSubtext(copy?.subtext ?? "");
    setCta(copy?.cta ?? "");
    setAspect(initialAspect);
    setStyleId(styleReferenceId ?? "");
    setChangeNote("");
    setExactPrompt("");
    setShowPrompt(false);
    setFile(null);
    setAddFile(null);
    setAddRole("place");
    setAddNote("");
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
      const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
        image?: ContentImage;
        copy?: FlyerCopy;
        aspect?: FlyerAspect;
      };
      if (!res.ok || !data.image) throw new ApiError(data.error ?? failMessage, data);
      onApplied(data.image, data.copy ?? copy, data.aspect ?? aspect);
      toast.success("Flyer updated.");
      onClose();
    } catch (err) {
      toastApiError(toast, err instanceof ApiError ? err : null, failMessage);
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
    if (model) form.set("model", model);
    if (showPrompt && exactPrompt.trim()) {
      form.set("exactPrompt", exactPrompt.trim());
    } else if (changeNote.trim()) {
      form.set("changeNote", changeNote.trim());
    }
    void submit(form, "Couldn't regenerate the flyer.");
  }

  function handleAdd() {
    if (!addFile) return;
    const form = new FormData();
    form.set("mode", "generate");
    form.set("reference", addFile);
    form.set("referenceRole", addRole);
    if (addRole === "place" && addNote.trim()) form.set("referenceNote", addNote.trim());
    if (model) form.set("model", model);
    void submit(form, "Couldn't add the image.");
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
          ) : tab === "add" ? (
            <Button
              variant="gradient"
              className="flex-1"
              loading={busy}
              disabled={!addFile}
              onClick={handleAdd}
            >
              {addRole === "place" ? "Add to design" : "Restyle from it"}
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
            { value: "add", label: "Add an image" },
            { value: "upload", label: "Replace with mine" },
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
            {!showPrompt && (
              <Field
                label="What should change? (optional)"
                hint="Added to the design prompt as a priority instruction."
              >
                <Textarea
                  rows={3}
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="Greener background, put the phone on the right, bigger headline"
                  maxLength={500}
                  disabled={busy}
                />
              </Field>
            )}
            <Field label="Post shape">
              <SegmentedControl
                value={aspect}
                onChange={(v) => setAspect(v as FlyerAspect)}
                options={ASPECT_OPTIONS}
                size="sm"
              />
            </Field>
            <Field
              label="Image model"
              hint={imageModelOptions.find((m) => m.id === model)?.description ?? "Uses the model picked in Settings."}
            >
              <Select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
                <option value="">My default</option>
                {imageModelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
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
                {showPrompt ? "Hide the full prompt" : "View or edit the full prompt"}
              </button>
              {showPrompt && (
                <Field
                  className="mt-2"
                  hint="The prompt behind the current design. Sent to the image model exactly as written; the fields above and the change note are ignored for the visuals (the headline still names the draft)."
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
        ) : tab === "add" ? (
          <>
            <Field label="Your image" hint="A product, a person, a logo, or a design you like. JPEG, PNG, or WebP up to 10MB.">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setAddFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-surface-3 file:px-4 file:py-2 file:text-[13px] file:font-medium file:text-foreground hover:file:bg-surface-2"
              />
            </Field>
            <Field
              label="Use it to"
              hint={
                addRole === "place"
                  ? "Keeps this design and its text, and adds your image into it. One or two renders."
                  : "Redraws the flyer in the style of your image, with the same text. One render."
              }
            >
              <SegmentedControl
                value={addRole}
                onChange={(v) => setAddRole(v as "place" | "style")}
                options={[
                  { value: "place", label: "Put it in the design" },
                  { value: "style", label: "Copy its style" },
                ]}
                size="sm"
              />
            </Field>
            {addRole === "place" && (
              <Field label="Where or how (optional)">
                <Input
                  value={addNote}
                  onChange={(e) => setAddNote(e.target.value)}
                  placeholder="Put her on the right, holding the phone"
                  maxLength={300}
                  disabled={busy}
                />
              </Field>
            )}
            <Field
              label="Image model"
              hint={imageModelOptions.find((m) => m.id === model)?.description ?? "Uses the model picked in Settings."}
            >
              <Select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
                <option value="">My default</option>
                {imageModelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            {addFile && (
              <div className="overflow-hidden rounded-xl border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={URL.createObjectURL(addFile)} alt="Image to add" className="max-h-64 w-full object-contain" />
              </div>
            )}
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
