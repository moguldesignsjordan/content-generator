"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, SegmentedControl, Sheet } from "@/components/ui";
import type { ContentImage, HeroPlacement } from "@/lib/db/types";

// The one image tool for a draft: generate an on-brand hero (optionally
// steered by a reference image), upload your own, move it, or remove it.
// Shared by the email review screen (with placement control; the image is
// spliced into the email HTML) and the blog review screen (hero pinned under
// the title; published to Sanity as the post's main image).

const IMAGE_STYLES = [
  {
    id: "illustration",
    label: "Illustration",
    description: "Flat editorial vector art in brand colors, bold and clean.",
  },
  {
    id: "photo",
    label: "Photo",
    description: "Premium photography, natural light, graded to the brand palette.",
  },
  {
    id: "texture",
    label: "Brand texture",
    description: "Abstract gradient backdrop built only from brand colors.",
  },
  {
    id: "render3d",
    label: "Soft 3D",
    description: "Soft matte 3D shapes with studio lighting, playful but polished.",
  },
  {
    id: "collage",
    label: "Collage",
    description: "Layered paper-cutout collage, tactile and editorial.",
  },
  {
    id: "lineart",
    label: "Line art",
    description: "Minimal single-line drawing with one accent fill, gallery-sparse.",
  },
] as const;

const REFERENCE_USES = [
  { id: "style", label: "Match its style" },
  { id: "subject", label: "Feature its subject" },
  { id: "both", label: "Both" },
] as const;

const PLACEMENTS: { id: HeroPlacement; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "below_headline", label: "Below headline" },
  { id: "above_cta", label: "Above button" },
];

/** The pill-button vocabulary every option row in this sheet uses. */
function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-50 ${
        active
          ? "border-accent bg-accent/10 text-foreground"
          : "border-border bg-surface-2 text-foreground hover:bg-surface-3"
      }`}
    >
      {children}
    </button>
  );
}

/** Local image chooser with a thumbnail preview; parent owns the File. */
function ImageFilePicker({
  file,
  onChange,
  disabled,
  emptyLabel,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  disabled?: boolean;
  emptyLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {file && preview ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="h-12 w-20 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] text-foreground">{file.name}</p>
            <p className="text-[11px] text-muted">{Math.max(1, Math.round(file.size / 1024))} KB</p>
          </div>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-xl border border-dashed border-border bg-surface-2 px-3 py-4 text-[12.5px] text-muted transition-colors hover:bg-surface-3 hover:text-foreground disabled:opacity-50"
        >
          {emptyLabel}
        </button>
      )}
    </div>
  );
}

export interface ImageSheetProps {
  open: boolean;
  onClose: () => void;
  draftId: string;
  /** Emails get placement control; a blog hero always sits under the title. */
  kind: "email" | "blog";
  hasImage: boolean;
  /** Where the current image sits (emails; undefined reads as "top"). */
  placement?: HeroPlacement;
  /** The prompt that produced the current image, if it was generated. */
  promptUsed?: string;
  /** Fresh HTML after any successful change; image is null after a remove. */
  onApplied: (html: string, image: ContentImage | null) => void;
  /** Fires alongside onApplied so sibling UI (the undo history) can refresh. */
  onEdited?: () => void;
}

export function ImageSheet({
  open,
  onClose,
  draftId,
  kind,
  hasImage,
  placement: currentPlacement,
  promptUsed,
  onApplied,
  onEdited,
}: ImageSheetProps) {
  const [tab, setTab] = useState<"generate" | "upload">("generate");
  const [style, setStyle] = useState<string>("illustration");
  const [subject, setSubject] = useState("");
  const [promptMode, setPromptMode] = useState<"auto" | "exact">("auto");
  const [showPrompt, setShowPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceUse, setReferenceUse] = useState<string>("style");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadAlt, setUploadAlt] = useState("");
  const [placement, setPlacement] = useState<HeroPlacement>(currentPlacement ?? "top");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh sheet every time it opens; placement mirrors where the image is now.
  useEffect(() => {
    if (!open) return;
    setTab("generate");
    setSubject("");
    setPromptMode("auto");
    setShowPrompt(false);
    setEditedPrompt(promptUsed ?? "");
    setReferenceFile(null);
    setReferenceUse("style");
    setUploadFile(null);
    setUploadAlt("");
    setError(null);
    setPlacement(currentPlacement ?? "top");
  }, [open, currentPlacement, promptUsed]);

  async function run(
    action: "generate" | "upload" | "remove" | "move",
    moveTo?: HeroPlacement,
    opts?: { exactPrompt?: string },
  ) {
    if (busy) return;
    if (action === "upload" && !uploadFile) {
      setError("Choose an image to upload first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let init: RequestInit;
      if (action === "remove") {
        init = { method: "DELETE" };
      } else {
        const form = new FormData();
        form.set("mode", action);
        if (kind === "email") form.set("placement", moveTo ?? placement);
        if (action === "upload") {
          form.set("file", uploadFile!);
          if (uploadAlt.trim()) form.set("alt", uploadAlt.trim());
        } else if (action === "generate") {
          form.set("style", style);
          if (subject.trim()) form.set("subject", subject.trim());
          if (promptMode === "exact") form.set("promptMode", "exact");
          if (opts?.exactPrompt) form.set("exactPrompt", opts.exactPrompt);
          if (referenceFile) {
            form.set("reference", referenceFile);
            form.set("referenceUse", referenceUse);
          }
        }
        init = { method: "POST", body: form };
      }
      const res = await fetch(`/api/drafts/${draftId}/image`, init);
      const data = (await res.json()) as {
        html?: string;
        image?: ContentImage;
        error?: string;
      };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't update the image.");
      }
      onApplied(data.html, action === "remove" ? null : (data.image ?? null));
      onEdited?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the image.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The placement row: with an image in place a tap moves it right away (a
   * pure string splice server-side, no model call) and closes the sheet so
   * the result is visible; before that it just sets where the next
   * generate/upload will land.
   */
  function handlePlacement(next: HeroPlacement) {
    if (hasImage) {
      void run("move", next);
    } else {
      setPlacement(next);
    }
  }

  const placementRow = kind === "email" && (
    <div className="mt-4">
      <p className="text-xs font-medium text-muted">Position in the email</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PLACEMENTS.map((p) => (
          <Chip
            key={p.id}
            active={placement === p.id}
            disabled={busy}
            onClick={() => handlePlacement(p.id)}
          >
            {p.label}
          </Chip>
        ))}
      </div>
      {hasImage && (
        <p className="mt-1.5 text-[11px] text-muted">
          Tap a position to move the image right away.
        </p>
      )}
    </div>
  );

  const removeButton = hasImage && (
    <Button variant="outline" size="sm" disabled={busy} onClick={() => run("remove")}>
      Remove
    </Button>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Image"
      description={
        kind === "email"
          ? "Generate an on-brand image or upload your own."
          : "Give this post a hero image; it publishes with the article."
      }
    >
      <SegmentedControl
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: "generate", label: "Generate" },
          { value: "upload", label: "Upload" },
        ]}
      />

      {tab === "generate" && (
        <>
          <p className="mt-4 text-xs font-medium text-muted">Style</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {IMAGE_STYLES.map((s) => (
              <Chip
                key={s.id}
                active={style === s.id}
                disabled={busy}
                onClick={() => setStyle(s.id)}
              >
                {s.label}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            {IMAGE_STYLES.find((s) => s.id === style)?.description}
          </p>
          <div className="mt-3">
            <p className="text-xs font-medium text-muted">
              What should it show? (optional)
            </p>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. a desk with a laptop and coffee"
              disabled={busy}
              className="mt-1.5"
            />
            {subject.trim() && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Chip
                  active={promptMode === "auto"}
                  disabled={busy}
                  onClick={() => setPromptMode("auto")}
                >
                  AI sharpens it
                </Chip>
                <Chip
                  active={promptMode === "exact"}
                  disabled={busy}
                  onClick={() => setPromptMode("exact")}
                >
                  Use my words exactly
                </Chip>
              </div>
            )}
            {subject.trim() && (
              <p className="mt-1.5 text-[11px] text-muted">
                {promptMode === "exact"
                  ? "Your description goes to the image model word for word, only the style and brand colors are added."
                  : "AI adds visual detail around your description; everything you named stays in."}
              </p>
            )}
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-muted">Reference image (optional)</p>
            <div className="mt-1.5">
              <ImageFilePicker
                file={referenceFile}
                onChange={setReferenceFile}
                disabled={busy}
                emptyLabel="+ Add a reference image to steer the result"
              />
            </div>
            {referenceFile && (
              <div className="mt-2 flex flex-wrap gap-2">
                {REFERENCE_USES.map((u) => (
                  <Chip
                    key={u.id}
                    active={referenceUse === u.id}
                    disabled={busy}
                    onClick={() => setReferenceUse(u.id)}
                  >
                    {u.label}
                  </Chip>
                ))}
              </div>
            )}
          </div>
          {placementRow}
          {hasImage && promptUsed && (
            <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowPrompt((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                <span>Prompt behind the current image</span>
                <span>{showPrompt ? "Hide" : "View & edit"}</span>
              </button>
              {showPrompt && (
                <>
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    disabled={busy}
                    rows={5}
                    className="mt-2 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-foreground focus:border-accent"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    loading={busy}
                    disabled={busy || !editedPrompt.trim()}
                    onClick={() =>
                      run("generate", undefined, { exactPrompt: editedPrompt.trim() })
                    }
                  >
                    Regenerate with this prompt
                  </Button>
                  <p className="mt-1.5 text-[11px] text-muted">
                    Sent to the image model exactly as written, no AI rewrite.
                  </p>
                </>
              )}
            </div>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="gradient"
              size="sm"
              loading={busy}
              disabled={busy}
              onClick={() => run("generate")}
            >
              {hasImage ? "Regenerate image" : "Generate image"}
            </Button>
            {removeButton}
          </div>
          <p className="mt-2 text-[11px] text-muted">Takes about 20 seconds.</p>
        </>
      )}

      {tab === "upload" && (
        <>
          <p className="mt-4 text-xs font-medium text-muted">Your image</p>
          <div className="mt-1.5">
            <ImageFilePicker
              file={uploadFile}
              onChange={setUploadFile}
              disabled={busy}
              emptyLabel="+ Choose an image (JPEG, PNG, WebP, up to 10MB)"
            />
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-muted">
              Describe it for readers (alt text, optional)
            </p>
            <Input
              value={uploadAlt}
              onChange={(e) => setUploadAlt(e.target.value)}
              placeholder="e.g. our team reviewing a homepage redesign"
              disabled={busy}
              className="mt-1.5"
            />
          </div>
          {placementRow}
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="gradient"
              size="sm"
              loading={busy}
              disabled={busy || !uploadFile}
              onClick={() => run("upload")}
            >
              {hasImage ? "Replace with this image" : "Use this image"}
            </Button>
            {removeButton}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Resized and compressed automatically (JPEG, under 150KB).
          </p>
        </>
      )}

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </Sheet>
  );
}
