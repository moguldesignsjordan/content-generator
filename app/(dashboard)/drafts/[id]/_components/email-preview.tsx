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
import { ImageSheet } from "./image-sheet";
import type { ContentImage } from "@/lib/db/types";
import { forceColorScheme, type EmailPreviewMode } from "@/lib/email/preview-mode";
import { guessStyleValue, type StyleChanges } from "@/lib/email/inline-style";

// Click-to-edit creative control: overlays the rendered email with invisible
// hotspot buttons over every [data-region] element the design/templates tag
// (header, eyebrow, headline, body, cta, footer). Tapping one opens a sheet
// with ONE tool visible at a time (Wording | Design | Style tabs):
//   - WORDING: a textarea pre-filled with the region's current text. "Apply
//     text" swaps it in verbatim, natively (no model call) for regions whose
//     structure is simple enough (falls back to AI only if not); "Rewrite it
//     for me" always asks the model to rephrase. -> POST /api/drafts/[id]/copy
//   - DESIGN: native, no-AI mechanical controls (text color, background,
//     spacing, font size, alignment, bold), each an instant inline-style
//     mutation on just this region. -> POST /api/drafts/[id]/style-edit
//   - STYLE: fuzzy free-text asks the model can't do mechanically (quick
//     chips + a custom instruction). -> POST /api/drafts/[id]/adjust-style
// All three are scoped to the region's exact HTML so the edit lands
// precisely, and all update this preview live via onHtmlChange. The image
// region opens the shared ImageSheet instead (generate/upload/move/remove).
//
// Design/native "Apply text" edits locate their target by the region's exact
// occurrence index (regionIndex) scanned in the STORED html server-side, not
// by the client-sent `snippet` — the iframe's el.outerHTML is browser-
// normalized (attribute order/quoting/entities) and may not byte-match the
// stored string, so it's kept only as a display/AI hint, never a find-anchor
// for native edits.
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

// Only genuinely fuzzy asks stay as AI chips — "larger text", "more
// breathing room", and "bolder" are now native, instant Design controls.
const SUGGESTION_CHIPS = ["Stronger color", "Soften the tone"];

type ToolTab = "wording" | "design" | "style";
type SpacingPreset = "compact" | "normal" | "roomy";
type Alignment = "left" | "center" | "right";

const SPACING_MARGIN: Record<SpacingPreset, string> = {
  compact: "8px 0",
  normal: "20px 0",
  roomy: "40px 0",
};

/** Best-effort: reconstructs the design controls' initial state from a region's current inline style. Not authoritative — a native edit always starts from what's actually there, never invents a value the model would have to guess either. */
function guessDesignState(snippet: string): {
  color: string;
  background: string;
  spacing: SpacingPreset;
  fontSize: number;
  align: Alignment;
  bold: boolean;
} {
  const color = guessStyleValue(snippet, "color");
  const background = guessStyleValue(snippet, "background");
  const margin = guessStyleValue(snippet, "margin");
  const fontSizeRaw = guessStyleValue(snippet, "fontSize");
  const align = guessStyleValue(snippet, "textAlign");
  const weight = guessStyleValue(snippet, "fontWeight");

  const marginNums = margin ? margin.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [] : [];
  const maxMargin = marginNums.length ? Math.max(...marginNums) : 20;
  const spacing: SpacingPreset = maxMargin <= 12 ? "compact" : maxMargin >= 30 ? "roomy" : "normal";

  return {
    color: color?.startsWith("#") ? color.slice(0, 7) : "#000000",
    background: background?.startsWith("#") ? background.slice(0, 7) : "#ffffff",
    spacing,
    fontSize: fontSizeRaw ? parseInt(fontSizeRaw, 10) || 16 : 16,
    align: align === "center" || align === "right" ? align : "left",
    bold: weight === "bold" || (weight ? parseInt(weight, 10) >= 600 : false),
  };
}

interface Hotspot {
  region: string;
  /** This region's 0-based occurrence among all same-named regions (a region like "body" can repeat) — how native edits locate their target server-side. */
  regionIndex: number;
  label: string;
  snippet: string;
  /** The region's visible text, used to pre-fill the wording textarea. */
  text: string;
  rect: { top: number; left: number; width: number; height: number };
}

interface EmailPreviewProps {
  draftId: string;
  html: string;
  onHtmlChange: (html: string) => void;
  /** The hero image currently in the draft, if any (drives the move control). */
  initialImage?: ContentImage;
  /** Notified after a successful region edit, so sibling UI (DesignChat's history log) can refresh. */
  onEdited?: () => void;
  /** Preview-only: forces the iframe to render light/dark regardless of system preference. Never affects `html` or persisted content. */
  previewMode: EmailPreviewMode;
}

export function EmailPreview({
  draftId,
  html,
  onHtmlChange,
  initialImage,
  onEdited,
  previewMode,
}: EmailPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [active, setActive] = useState<Hotspot | null>(null);
  const [tool, setTool] = useState<ToolTab>("wording");
  const [customInput, setCustomInput] = useState("");
  const [textValue, setTextValue] = useState("");
  const [designColor, setDesignColor] = useState("#000000");
  const [designBackground, setDesignBackground] = useState("#ffffff");
  const [designSpacing, setDesignSpacing] = useState<SpacingPreset>("normal");
  const [designFontSize, setDesignFontSize] = useState(16);
  const [designAlign, setDesignAlign] = useState<Alignment>("left");
  const [designBold, setDesignBold] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [image, setImage] = useState<ContentImage | null>(initialImage ?? null);
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
      const seen: Record<string, number> = {};
      setHotspots(
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          const region = el.getAttribute("data-region") ?? "";
          const regionIndex = seen[region] ?? 0;
          seen[region] = regionIndex + 1;
          return {
            region,
            regionIndex,
            label: REGION_LABELS[region] ?? region,
            snippet: el.outerHTML,
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
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
  }, [html, previewMode]);

  function openHotspot(h: Hotspot) {
    if (h.region === "image") {
      setImageOpen(true);
      return;
    }
    setActive(h);
    setTool("wording");
    setTextValue(h.text);
    const design = guessDesignState(h.snippet);
    setDesignColor(design.color);
    setDesignBackground(design.background);
    setDesignSpacing(design.spacing);
    setDesignFontSize(design.fontSize);
    setDesignAlign(design.align);
    setDesignBold(design.bold);
    setCustomInput("");
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
          regionIndex: active.regionIndex,
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

  /**
   * A DESIGN change on the active region: one or more mechanical CSS
   * properties, applied instantly with no model call. Unlike Wording/Style,
   * this deliberately doesn't close the sheet, so color/spacing/font/align/
   * bold tweaks can be chained without reopening the hotspot each time.
   */
  async function applyStyleEdit(changes: StyleChanges) {
    if (!active || applying) return;
    setApplying(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/style-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: active.region,
          regionIndex: active.regionIndex,
          regionLabel: active.label,
          changes,
        }),
      });
      const data = (await res.json()) as { html?: string; error?: string };
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "Couldn't apply that change.");
      }
      onHtmlChange(data.html);
      onEdited?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't apply that change.");
    } finally {
      setApplying(false);
    }
  }

  const textUnchanged = !active || textValue.trim() === active.text;

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
        key={`${html}::${previewMode}`}
        title="Email preview"
        srcDoc={forceColorScheme(html, previewMode)}
        sandbox="allow-same-origin"
        className="h-[600px] w-full bg-white"
      />
      {loaded && !hasImage && (
        <button
          type="button"
          onClick={() => setImageOpen(true)}
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

      {/* Image tool: generate, upload, move, or remove the hero image. */}
      <ImageSheet
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        draftId={draftId}
        kind="email"
        hasImage={hasImage}
        placement={image?.placement}
        promptUsed={image?.prompt}
        onApplied={(newHtml, newImage) => {
          onHtmlChange(newHtml);
          setImage(newImage);
        }}
        onEdited={onEdited}
      />

      {/* Region editor: one tool at a time. */}
      <Sheet
        open={!!active}
        onClose={closeSheet}
        title={active?.label}
        description="Change just this part of the email."
      >
        <SegmentedControl
          size="sm"
          value={tool}
          onChange={setTool}
          options={[
            { value: "wording", label: "Wording" },
            { value: "design", label: "Design" },
            { value: "style", label: "Style" },
          ]}
        />

        {tool === "wording" && (
          <div className="mt-4">
            <Textarea
              rows={4}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Edit this text…"
              disabled={applying}
            />
            <div className="mt-2.5 flex items-center gap-2">
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
                Rewrite it for me
              </Button>
            </div>
          </div>
        )}

        {tool === "design" && (
          <div className="mt-4 space-y-5">
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted">Text color</p>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={designColor}
                  onChange={(e) => setDesignColor(e.target.value)}
                  disabled={applying}
                  aria-label="Pick a text color"
                  className="h-9 w-9 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:opacity-50"
                />
                <Input
                  value={designColor}
                  onChange={(e) => setDesignColor(e.target.value)}
                  placeholder="#000000"
                  disabled={applying}
                  className="w-28"
                />
                <Button
                  variant="gradient"
                  size="sm"
                  loading={applying}
                  disabled={applying}
                  onClick={() => applyStyleEdit({ color: designColor })}
                >
                  Apply
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted">Background</p>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={designBackground}
                  onChange={(e) => setDesignBackground(e.target.value)}
                  disabled={applying}
                  aria-label="Pick a background color"
                  className="h-9 w-9 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:opacity-50"
                />
                <Input
                  value={designBackground}
                  onChange={(e) => setDesignBackground(e.target.value)}
                  placeholder="#ffffff"
                  disabled={applying}
                  className="w-28"
                />
                <Button
                  variant="gradient"
                  size="sm"
                  loading={applying}
                  disabled={applying}
                  onClick={() => applyStyleEdit({ background: designBackground })}
                >
                  Apply
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted">Spacing</p>
              <SegmentedControl
                size="sm"
                value={designSpacing}
                onChange={(v) => {
                  setDesignSpacing(v);
                  applyStyleEdit({ margin: SPACING_MARGIN[v] });
                }}
                options={[
                  { value: "compact", label: "Compact" },
                  { value: "normal", label: "Normal" },
                  { value: "roomy", label: "Roomy" },
                ]}
              />
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted">Font size</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={applying || designFontSize <= 10}
                  onClick={() => {
                    const next = Math.max(10, designFontSize - 2);
                    setDesignFontSize(next);
                    applyStyleEdit({ fontSize: `${next}px` });
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-2 text-foreground transition-colors hover:bg-surface-3 disabled:opacity-40"
                  aria-label="Decrease font size"
                >
                  −
                </button>
                <span className="w-12 text-center text-[13px] text-foreground">{designFontSize}px</span>
                <button
                  type="button"
                  disabled={applying || designFontSize >= 64}
                  onClick={() => {
                    const next = Math.min(64, designFontSize + 2);
                    setDesignFontSize(next);
                    applyStyleEdit({ fontSize: `${next}px` });
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-2 text-foreground transition-colors hover:bg-surface-3 disabled:opacity-40"
                  aria-label="Increase font size"
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted">Alignment</p>
              <SegmentedControl
                size="sm"
                value={designAlign}
                onChange={(v) => {
                  setDesignAlign(v);
                  applyStyleEdit({ textAlign: v });
                }}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
              />
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted">Weight</p>
              <button
                type="button"
                disabled={applying}
                onClick={() => {
                  const next = !designBold;
                  setDesignBold(next);
                  applyStyleEdit({ fontWeight: next ? "700" : "400" });
                }}
                aria-pressed={designBold}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-40 ${
                  designBold
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface-2 text-foreground hover:bg-surface-3"
                }`}
              >
                Bold
              </button>
            </div>
          </div>
        )}

        {tool === "style" && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
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
                variant="gradient"
                size="sm"
                loading={applying}
                disabled={!customInput.trim() || applying}
                onClick={() => applyStyle(customInput.trim())}
              >
                Apply
              </Button>
            </div>
          </div>
        )}

        {editError && <p className="mt-3 text-xs text-danger">{editError}</p>}
      </Sheet>
    </div>
  );
}
