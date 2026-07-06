"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Sheet, Skeleton, Textarea } from "@/components/ui";
import type { BlogCopy } from "@/lib/db/types";

// Click-to-edit for blog articles: overlays the rendered preview with
// invisible hotspot buttons over every [data-field] element the preview
// renderer tags (title, slug, intro, each section's heading/body,
// conclusion, cta — see lib/blog/render-preview.ts). Tapping one opens a
// small sheet pre-filled with that field's raw text, "Save" PATCHes
// /api/drafts/[id]/blog-copy with the full updated copy object and swaps in
// the re-rendered preview. This replaces a parallel form that duplicated
// every section as its own field; editing now happens on the article itself.
//
// The srcDoc iframe is same-origin content, sandboxed with allow-same-origin
// (but NOT allow-scripts, so the model-authored HTML still can't execute
// anything) so the parent can read iframe.contentDocument to find fields and
// measure their on-screen position.

const FIELD_LABELS: Record<string, string> = {
  title: "Headline",
  slug: "URL slug",
  intro: "Intro",
  "section-heading": "Section heading",
  "section-body": "Section body",
  conclusion: "Conclusion",
  cta: "Call to action",
};

const MARKDOWN_HINT =
  "Basic markdown works here: **bold**, *italic*, - bullets, > quotes, [text](url).";

interface Hotspot {
  field: string;
  index?: number;
  label: string;
  rect: { top: number; left: number; width: number; height: number };
}

interface BlogPreviewProps {
  draftId: string;
  copy: BlogCopy | null;
  html: string;
  onSaved: (html: string, copy: BlogCopy) => void;
}

export function BlogPreview({ draftId, copy, html, onSaved }: BlogPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [active, setActive] = useState<Hotspot | null>(null);
  const [value, setValue] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const iframe = iframeRef.current;
    const container = containerRef.current;
    if (!iframe || !container) return;

    function recompute() {
      const doc = iframe!.contentDocument;
      if (!doc || !copy) return;
      const containerRect = container!.getBoundingClientRect();
      const iframeRect = iframe!.getBoundingClientRect();
      const elements = Array.from(doc.querySelectorAll<HTMLElement>("[data-field]"));
      setHotspots(
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          const field = el.getAttribute("data-field") ?? "";
          const indexAttr = el.getAttribute("data-index");
          return {
            field,
            index: indexAttr !== null ? Number(indexAttr) : undefined,
            label: FIELD_LABELS[field] ?? field,
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
  }, [html, copy]);

  function fieldValue(h: Hotspot): string {
    if (!copy) return "";
    switch (h.field) {
      case "title":
        return copy.title;
      case "slug":
        return copy.slug;
      case "intro":
        return copy.intro;
      case "conclusion":
        return copy.conclusion;
      case "section-heading":
        return h.index !== undefined ? copy.sections[h.index]?.heading ?? "" : "";
      case "section-body":
        return h.index !== undefined ? copy.sections[h.index]?.body ?? "" : "";
      case "cta":
        return copy.cta_text;
      default:
        return "";
    }
  }

  function openHotspot(h: Hotspot) {
    if (!copy) return;
    setActive(h);
    setValue(fieldValue(h));
    setCtaUrl(h.field === "cta" ? copy.cta_url ?? "" : "");
    setSaveError(null);
  }

  function closeSheet() {
    setActive(null);
    setValue("");
    setCtaUrl("");
    setSaveError(null);
  }

  function buildNextCopy(): BlogCopy | null {
    if (!copy || !active) return null;
    switch (active.field) {
      case "title":
        return { ...copy, title: value };
      case "slug":
        return { ...copy, slug: value };
      case "intro":
        return { ...copy, intro: value };
      case "conclusion":
        return { ...copy, conclusion: value };
      case "section-heading":
        if (active.index === undefined) return copy;
        return {
          ...copy,
          sections: copy.sections.map((s, i) =>
            i === active.index ? { ...s, heading: value } : s,
          ),
        };
      case "section-body":
        if (active.index === undefined) return copy;
        return {
          ...copy,
          sections: copy.sections.map((s, i) =>
            i === active.index ? { ...s, body: value } : s,
          ),
        };
      case "cta":
        return { ...copy, cta_text: value, cta_url: ctaUrl.trim() || undefined };
      default:
        return copy;
    }
  }

  async function handleSave() {
    const next = buildNextCopy();
    if (!next) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/blog-copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await res.json().catch(() => ({}))) as {
        html?: string;
        copy?: BlogCopy;
        error?: string;
      };
      if (!res.ok || !data.html || !data.copy) {
        throw new Error(data.error ?? "Couldn't save your edit.");
      }
      onSaved(data.html, data.copy);
      closeSheet();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save your edit.");
    } finally {
      setSaving(false);
    }
  }

  const unchanged = (() => {
    if (!active || !copy) return true;
    if (active.field === "cta") {
      return value === copy.cta_text && ctaUrl === (copy.cta_url ?? "");
    }
    return value === fieldValue(active);
  })();

  const isMultiline =
    active?.field === "intro" ||
    active?.field === "section-body" ||
    active?.field === "conclusion";

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {!loaded && (
        <div className="absolute inset-0 z-10 space-y-3 bg-white p-8">
          <Skeleton height={28} width="60%" />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="80%" />
          <Skeleton height={14} width="70%" className="mt-6" />
          <Skeleton height={14} width="90%" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        key={html}
        title="Blog preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        className="h-[720px] w-full bg-white"
      />
      {copy &&
        hotspots.map((h, i) => (
          <button
            key={`${h.field}-${h.index ?? ""}-${i}`}
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
        description={isMultiline ? MARKDOWN_HINT : "Change just this part of the article."}
      >
        {active?.field === "cta" ? (
          <div className="space-y-3">
            <Field label="Button text">
              <Input value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} />
            </Field>
            <Field label="Button link" hint="Optional.">
              <Input
                type="url"
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://…"
                disabled={saving}
              />
            </Field>
          </div>
        ) : isMultiline ? (
          <Textarea
            rows={8}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving}
          />
        ) : (
          <Input value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} />
        )}

        {saveError && <p className="mt-2 text-xs text-danger">{saveError}</p>}

        <div className="mt-3 flex justify-end">
          <Button
            variant="gradient"
            size="sm"
            loading={saving}
            disabled={unchanged || saving || !value.trim()}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
