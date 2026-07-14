"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, SegmentedControl } from "@/components/ui";
import { guessStyleValue, type StyleChanges } from "@/lib/email/inline-style";

// The mechanical, no-AI style controls for one email section: colour,
// background, spacing, size, alignment, weight. Previously a tab inside the
// edit Sheet; now a small panel anchored to the section's toolbar, because the
// Sheet is gone and these are the one thing that genuinely needs a surface of
// its own.
//
// Same behaviour as before: every control applies instantly to just this
// section (no model call), and the panel stays open so tweaks can be chained.
// Email only — a blog's look comes from the renderer's stylesheet, so there is
// nothing per-element to restyle.

type SpacingPreset = "compact" | "normal" | "roomy";
type Alignment = "left" | "center" | "right";

const SPACING_MARGIN: Record<SpacingPreset, string> = {
  compact: "8px 0",
  normal: "20px 0",
  roomy: "40px 0",
};

/** Best-effort read of a section's current inline style, to seed the controls. */
function guessDesignState(snippet: string) {
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
    align: (align === "center" || align === "right" ? align : "left") as Alignment,
    bold: weight === "bold" || (weight ? parseInt(weight, 10) >= 600 : false),
  };
}

interface DesignPopoverProps {
  /** The section's current outerHTML, for seeding the controls. */
  snippet: string;
  /** Where to anchor, in container coordinates. */
  anchor: { top: number; left: number };
  busy: boolean;
  onApply: (changes: StyleChanges) => void;
  onClose: () => void;
}

export function DesignPopover({ snippet, anchor, busy, onApply, onClose }: DesignPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = guessDesignState(snippet);
  const [color, setColor] = useState(initial.color);
  const [background, setBackground] = useState(initial.background);
  const [spacing, setSpacing] = useState<SpacingPreset>(initial.spacing);
  const [fontSize, setFontSize] = useState(initial.fontSize);
  const [align, setAlign] = useState<Alignment>(initial.align);
  const [bold, setBold] = useState(initial.bold);

  // Click-away closes, matching the rest of the inline editing model.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ top: anchor.top, left: anchor.left }}
      className="absolute z-40 w-[268px] space-y-4 rounded-xl border border-border bg-surface-1 p-3.5 shadow-xl"
    >
      <div>
        <p className="mb-1.5 text-[12px] font-medium text-muted">Text color</p>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            disabled={busy}
            aria-label="Pick a text color"
            className="h-8 w-8 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:opacity-50"
          />
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#000000"
            disabled={busy}
            className="w-24"
          />
          <Button
            variant="gradient"
            size="sm"
            disabled={busy}
            onClick={() => onApply({ color })}
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
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            disabled={busy}
            aria-label="Pick a background color"
            className="h-8 w-8 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:opacity-50"
          />
          <Input
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            placeholder="#ffffff"
            disabled={busy}
            className="w-24"
          />
          <Button
            variant="gradient"
            size="sm"
            disabled={busy}
            onClick={() => onApply({ background })}
          >
            Apply
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[12px] font-medium text-muted">Spacing</p>
        <SegmentedControl
          size="sm"
          value={spacing}
          onChange={(v) => {
            setSpacing(v);
            onApply({ margin: SPACING_MARGIN[v] });
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
            disabled={busy || fontSize <= 10}
            onClick={() => {
              const next = Math.max(10, fontSize - 2);
              setFontSize(next);
              onApply({ fontSize: `${next}px` });
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-2 text-foreground transition-colors hover:bg-surface-3 disabled:opacity-40"
            aria-label="Decrease font size"
          >
            −
          </button>
          <span className="w-12 text-center text-[13px] text-foreground">{fontSize}px</span>
          <button
            type="button"
            disabled={busy || fontSize >= 64}
            onClick={() => {
              const next = Math.min(64, fontSize + 2);
              setFontSize(next);
              onApply({ fontSize: `${next}px` });
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
          value={align}
          onChange={(v) => {
            setAlign(v);
            onApply({ textAlign: v });
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
          disabled={busy}
          onClick={() => {
            const next = !bold;
            setBold(next);
            onApply({ fontWeight: next ? "700" : "400" });
          }}
          aria-pressed={bold}
          className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-40 ${
            bold
              ? "border-accent bg-accent/10 text-accent"
              : "border-border bg-surface-2 text-foreground hover:bg-surface-3"
          }`}
        >
          Bold
        </button>
      </div>
    </div>
  );
}
