"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  SegmentedControl,
  Sheet,
  Skeleton,
  Textarea,
} from "@/components/ui";

// Click-to-edit creative control: overlays the rendered email with invisible
// hotspot buttons over every [data-region] element the design/templates tag
// (header, eyebrow, headline, body, cta, footer). Tapping one opens a sheet
// with THREE kinds of edits for just that part:
//   - WORDING: a textarea pre-filled with the region's current text, an
//     "Apply text" button (swap in your wording verbatim) and a "Regenerate"
//     button (AI rewrites that region's text). -> POST /api/drafts/[id]/copy
//   - COLOR: a color picker defaulting to the region's current color, an
//     "Apply color" button. -> POST /api/drafts/[id]/color
//   - STYLE: quick suggestion chips plus a free-text fallback. -> POST
//     /api/drafts/[id]/adjust-style
// All three are scoped to the region's exact HTML so the edit lands
// precisely, and all update this preview live via onHtmlChange.
//
// The srcDoc iframe is same-origin content, sandboxed with allow-same-origin
// (but NOT allow-scripts, so the untrusted model HTML still can't execute
// anything) so the parent can read iframe.contentDocument to find regions
// and measure their on-screen position.

const REGION_LABELS: Record<string, string> = {
  header: "Header",
  eyebrow: "Eyebrow",
  headline: "Headline",
  body: "Body text",
  cta: "Call to action",
  footer: "Footer",
  image: "Image",
};

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

const SUGGESTION_CHIPS = [
  "Make it bolder",
  "Larger text",
  "More breathing room",
  "Stronger color",
  "Soften the tone",
];

/** Best-effort: pulls the first hex color out of a region's inline styles, to pre-fill the color picker. Not authoritative — the model decides the real target property. */
function guessColor(snippet: string): string {
  const match = snippet.match(
    /(?:background-color|background|color)\s*:\s*(#[0-9a-fA-F]{3,8})/,
  );
  return match ? match[1].slice(0, 7) : "#000000";
}

interface Hotspot {
  region: string;
  label: string;
  snippet: string;
  /** The region's visible text, used to pre-fill the wording textarea. */
  text: string;
  /** Best-effort current color, used to pre-fill the color picker. */
  color: string;
  rect: { top: number; left: number; width: number; height: number };
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

interface EmailPreviewProps {
  draftId: string;
  html: string;
  onHtmlChange: (html: string) => void;
  /** Notified after a successful region edit, so sibling UI (DesignChat's history log) can refresh. */
  onEdited?: () => void;
}

export function EmailPreview({ draftId, html, onHtmlChange, onEdited }: EmailPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [active, setActive] = useState<Hotspot | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [textValue, setTextValue] = useState("");
  const [colorValue, setColorValue] = useState("#000000");
  const [imageStyle, setImageStyle] = useState<string>("illustration");
  const [imageSubject, setImageSubject] = useState("");
  const [imageTab, setImageTab] = useState<"generate" | "upload">("generate");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceUse, setReferenceUse] = useState<string>("style");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadAlt, setUploadAlt] = useState("");
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const hasImage = html.includes('data-region="image"');

  useEffect(() => {
    setLoaded(false);
    const iframe = iframeRef.current;
    const container = containerRef.current;
    if (!iframe || !container) return;

    function recompute() {
      const doc = iframe!.contentDocument;
      if (!doc) return;
      const containerRect = container!.getBoundingClientRect();
      const iframeRect = iframe!.getBoundingClientRect();
      const elements = Array.from(
        doc.querySelectorAll<HTMLElement>("[data-region]"),
      );
      setHotspots(
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          const region = el.getAttribute("data-region") ?? "";
          return {
            region,
            label: REGION_LABELS[region] ?? region,
            snippet: el.outerHTML,
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
            color: guessColor(el.outerHTML),
            rect: {
              top: iframeRect.top - containerRect.top + r.top,
              left: iframeRect.left - containerRect.left + r.left,
              width: r.width,
              height: r.height,
            },
          };
        }),
      );
    }

    let detachScroll: (() => void) | null = null;

    function onLoad() {
      recompute();
      setLoaded(true);
      const doc = iframe!.contentDocument;
      doc?.fonts?.ready?.then(recompute).catch(() => {});
      const win = iframe!.contentWindow;
      win?.addEventListener("scroll", recompute);
      detachScroll = () => win?.removeEventListener("scroll", recompute);
    }

    iframe.addEventListener("load", onLoad);
    const ro = new ResizeObserver(recompute);
    ro.observe(iframe);
    window.addEventListener("resize", recompute);

    return () => {
      iframe.removeEventListener("load", onLoad);
      ro.disconnect();
      window.removeEventListener("resize", recompute);
      detachScroll?.();
    };
  }, [html]);

  function resetImageState() {
    setImageSubject("");
    setImageTab("generate");
    setReferenceFile(null);
    setReferenceUse("style");
    setUploadFile(null);
    setUploadAlt("");
  }

  function openHotspot(h: Hotspot) {
    setActive(h);
    setTextValue(h.text);
    setColorValue(h.color);
    setCustomInput("");
    resetImageState();
    setEditError(null);
  }

  /** Opens the sheet in image mode when the email has no image yet. */
  function openAddImage() {
    setActive({
      region: "image",
      label: "Image",
      snippet: "",
      text: "",
      color: "#000000",
      rect: { top: 0, left: 0, width: 0, height: 0 },
    });
    resetImageState();
    setEditError(null);
  }

  function closeSheet() {
    setActive(null);
    setCustomInput("");
    setTextValue("");
    setEditError(null);
  }

  /** A STYLE change (chips or free text), scoped to the active region. */
  async function applyStyle(instruction: string) {
    if (!active || applying) return;
    setApplying(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/adjust-style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          region: active.region,
          regionLabel: active.label,
          snippet: active.snippet,
        }),
      });
      const data = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't apply that change.");
      }
      onHtmlChange(data.html);
      onEdited?.();
      closeSheet();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't apply that change.");
    } finally {
      setApplying(false);
    }
  }

  /**
   * A WORDING change on the active region. mode "edit" swaps in `newText`
   * verbatim; mode "regenerate" rewrites the region's text, optionally shaped
   * by `instruction`.
   */
  async function applyCopy(
    mode: "edit" | "regenerate",
    newText?: string,
    instruction?: string,
  ) {
    if (!active || applying) return;
    if (mode === "edit" && !newText?.trim()) return;
    setApplying(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: active.region,
          regionLabel: active.label,
          snippet: active.snippet,
          mode,
          ...(mode === "edit"
            ? { newText: newText ?? "" }
            : { instruction: instruction?.trim() || undefined }),
        }),
      });
      const data = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't apply that edit.");
      }
      onHtmlChange(data.html);
      onEdited?.();
      closeSheet();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't apply that edit.");
    } finally {
      setApplying(false);
    }
  }

  /** A COLOR change on the active region: swap it to the exact picked hex. */
  async function applyColor(hex: string) {
    if (!active || applying) return;
    setApplying(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/color`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: active.region,
          regionLabel: active.label,
          snippet: active.snippet,
          hex,
        }),
      });
      const data = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't apply that color.");
      }
      onHtmlChange(data.html);
      onEdited?.();
      closeSheet();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't apply that color.");
    } finally {
      setApplying(false);
    }
  }

  /** Generates the hero image, uploads the user's own, or removes it. */
  async function applyImage(action: "generate" | "upload" | "remove") {
    if (applying) return;
    if (action === "upload" && !uploadFile) {
      setEditError("Choose an image to upload first.");
      return;
    }
    setApplying(true);
    setEditError(null);
    try {
      let init: RequestInit;
      if (action === "remove") {
        init = { method: "DELETE" };
      } else {
        const form = new FormData();
        form.set("mode", action);
        if (action === "upload") {
          form.set("file", uploadFile!);
          if (uploadAlt.trim()) form.set("alt", uploadAlt.trim());
        } else {
          form.set("style", imageStyle);
          if (imageSubject.trim()) form.set("subject", imageSubject.trim());
          if (referenceFile) {
            form.set("reference", referenceFile);
            form.set("referenceUse", referenceUse);
          }
        }
        init = { method: "POST", body: form };
      }
      const res = await fetch(`/api/drafts/${draftId}/image`, init);
      const data = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't update the image.");
      }
      onHtmlChange(data.html);
      onEdited?.();
      closeSheet();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't update the image.");
    } finally {
      setApplying(false);
    }
  }

  const isImageRegion = active?.region === "image";
  const textUnchanged = !active || textValue.trim() === active.text;
  const colorUnchanged = !active || colorValue.toLowerCase() === active.color.toLowerCase();

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {!loaded && (
        <div className="absolute inset-0 z-10 space-y-3 bg-white p-8">
          <Skeleton height={28} width="60%" />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="80%" />
          <Skeleton height={40} width="40%" className="mt-6 rounded-full" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        key={html}
        title="Email preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        className="h-[600px] w-full bg-white"
      />
      {loaded && !hasImage && (
        <button
          type="button"
          onClick={openAddImage}
          className="absolute right-3 top-3 z-20 rounded-full border border-border bg-surface-2/90 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-surface-3"
        >
          + Add image
        </button>
      )}
      {hotspots.map((h, i) => (
        <button
          key={`${h.region}-${i}`}
          type="button"
          onClick={() => openHotspot(h)}
          style={{
            top: h.rect.top,
            left: h.rect.left,
            width: h.rect.width,
            height: h.rect.height,
          }}
          className="group absolute rounded-[4px] border-2 border-transparent transition-colors hover:border-accent hover:bg-accent/5"
          aria-label={`Edit ${h.label}`}
        >
          <span className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
            {h.label}
          </span>
        </button>
      ))}

      <Sheet
        open={!!active}
        onClose={closeSheet}
        title={active?.label}
        description={
          isImageRegion
            ? "Generate an on-brand image or upload your own."
            : "Edit the wording, color, or look of just this part."
        }
      >
        {/* IMAGE (its own mode; wording/color/style don't apply) */}
        {isImageRegion && (
          <div>
            <SegmentedControl
              size="sm"
              value={imageTab}
              onChange={setImageTab}
              options={[
                { value: "generate", label: "Generate" },
                { value: "upload", label: "Upload" },
              ]}
            />

            {imageTab === "generate" && (
              <>
                <p className="mt-4 text-xs font-medium text-muted">Style</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {IMAGE_STYLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={applying}
                      onClick={() => setImageStyle(s.id)}
                      className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-50 ${
                        imageStyle === s.id
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-border bg-surface-2 text-foreground hover:bg-surface-3"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted">
                  {IMAGE_STYLES.find((s) => s.id === imageStyle)?.description}
                </p>
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted">
                    What should it show? (optional)
                  </p>
                  <Input
                    value={imageSubject}
                    onChange={(e) => setImageSubject(e.target.value)}
                    placeholder="e.g. a desk with a laptop and coffee"
                    disabled={applying}
                    className="mt-1.5"
                  />
                </div>
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted">
                    Reference image (optional)
                  </p>
                  <div className="mt-1.5">
                    <ImageFilePicker
                      file={referenceFile}
                      onChange={setReferenceFile}
                      disabled={applying}
                      emptyLabel="+ Add a reference image to steer the result"
                    />
                  </div>
                  {referenceFile && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {REFERENCE_USES.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          disabled={applying}
                          onClick={() => setReferenceUse(u.id)}
                          className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50 ${
                            referenceUse === u.id
                              ? "border-accent bg-accent/10 text-foreground"
                              : "border-border bg-surface-2 text-foreground hover:bg-surface-3"
                          }`}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    variant="gradient"
                    size="sm"
                    loading={applying}
                    disabled={applying}
                    onClick={() => applyImage("generate")}
                  >
                    {hasImage ? "Regenerate image" : "Generate image"}
                  </Button>
                  {hasImage && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={applying}
                      onClick={() => applyImage("remove")}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  Takes about 20 seconds. Only runs when you ask, never automatically.
                </p>
              </>
            )}

            {imageTab === "upload" && (
              <>
                <p className="mt-4 text-xs font-medium text-muted">Your image</p>
                <div className="mt-1.5">
                  <ImageFilePicker
                    file={uploadFile}
                    onChange={setUploadFile}
                    disabled={applying}
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
                    disabled={applying}
                    className="mt-1.5"
                  />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    variant="gradient"
                    size="sm"
                    loading={applying}
                    disabled={applying || !uploadFile}
                    onClick={() => applyImage("upload")}
                  >
                    {hasImage ? "Replace with this image" : "Use this image"}
                  </Button>
                  {hasImage && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={applying}
                      onClick={() => applyImage("remove")}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  Resized and compressed for email automatically (JPEG, under 150KB).
                </p>
              </>
            )}
          </div>
        )}

        {/* WORDING */}
        {!isImageRegion && (
        <div>
          <p className="text-xs font-medium text-muted">Wording</p>
          <Textarea
            rows={3}
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder="Edit this text…"
            disabled={applying}
            className="mt-1.5"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="gradient"
              size="sm"
              loading={applying}
              disabled={textUnchanged || applying}
              onClick={() => applyCopy("edit", textValue)}
            >
              Apply text
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={applying}
              disabled={applying}
              onClick={() => applyCopy("regenerate")}
            >
              Regenerate
            </Button>
          </div>
        </div>
        )}

        {!isImageRegion && (
        <>
        <div className="my-4 border-t border-border" />

        {/* COLOR */}
        <div>
          <p className="text-xs font-medium text-muted">Color</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="color"
              value={colorValue}
              onChange={(e) => setColorValue(e.target.value)}
              disabled={applying}
              aria-label="Pick a color"
              className="h-9 w-9 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:opacity-50"
            />
            <Input
              value={colorValue}
              onChange={(e) => setColorValue(e.target.value)}
              placeholder="#000000"
              disabled={applying}
              className="w-28"
            />
            <Button
              variant="solid"
              size="sm"
              loading={applying}
              disabled={colorUnchanged || applying}
              onClick={() => applyColor(colorValue)}
            >
              Apply color
            </Button>
          </div>
        </div>

        <div className="my-4 border-t border-border" />

        {/* STYLE */}
        <div>
          <p className="text-xs font-medium text-muted">Style</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={applying}
                onClick={() => applyStyle(chip)}
                className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-surface-3 disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <Input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customInput.trim()) applyStyle(customInput.trim());
              }}
              placeholder="Or describe your own change…"
              disabled={applying}
            />
            <Button
              variant="solid"
              size="sm"
              loading={applying}
              disabled={!customInput.trim() || applying}
              onClick={() => applyStyle(customInput.trim())}
            >
              Apply
            </Button>
          </div>
        </div>
        </>
        )}

        {editError && <p className="mt-3 text-xs text-danger">{editError}</p>}
      </Sheet>
    </div>
  );
}
