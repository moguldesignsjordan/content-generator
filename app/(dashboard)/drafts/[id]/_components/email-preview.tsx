"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Sheet, Skeleton } from "@/components/ui";

// Click-to-edit creative control: overlays the rendered email with invisible
// hotspot buttons over every [data-region] element the design/templates tag
// (header, eyebrow, headline, body, cta, footer). Tapping one opens a sheet
// with quick suggestion chips plus a free-text fallback, both of which call
// the same cheap Haiku find/replace pipeline as the free-text DesignChat,
// just scoped to that region's exact HTML so the edit lands precisely.
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
};

const SUGGESTION_CHIPS = [
  "Make it bolder",
  "Larger text",
  "More breathing room",
  "Stronger color",
  "Soften the tone",
];

interface Hotspot {
  region: string;
  label: string;
  snippet: string;
  rect: { top: number; left: number; width: number; height: number };
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
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  async function applyChange(instruction: string) {
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
      setActive(null);
      setCustomInput("");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't apply that change.");
    } finally {
      setApplying(false);
    }
  }

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
      {hotspots.map((h, i) => (
        <button
          key={`${h.region}-${i}`}
          type="button"
          onClick={() => {
            setActive(h);
            setEditError(null);
          }}
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
        onClose={() => {
          setActive(null);
          setCustomInput("");
          setEditError(null);
        }}
        title={active?.label}
        description="Style only, in plain words. Applies just to this part."
      >
        <div className="flex flex-wrap gap-2">
          {SUGGESTION_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={applying}
              onClick={() => applyChange(chip)}
              className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-surface-3 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-end gap-2">
          <Input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customInput.trim()) applyChange(customInput.trim());
            }}
            placeholder="Or describe your own change…"
            disabled={applying}
          />
          <Button
            variant="gradient"
            size="sm"
            loading={applying}
            disabled={!customInput.trim() || applying}
            onClick={() => applyChange(customInput.trim())}
          >
            Apply
          </Button>
        </div>
        {editError && <p className="mt-2 text-xs text-danger">{editError}</p>}
      </Sheet>
    </div>
  );
}
