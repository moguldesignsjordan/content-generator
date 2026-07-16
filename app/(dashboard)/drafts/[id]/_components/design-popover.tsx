"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/** Converts a computed "rgb(a, b, c)" color to #hex; returns undefined for anything else (transparent, keywords). */
function rgbToHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (!m) return value.startsWith("#") ? value.slice(0, 7) : undefined;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return undefined; // fully transparent
  const hex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

/**
 * Best-effort read of a section's current inline style, to seed the controls.
 * `textSnippet` is the element that actually carries the text styling when it
 * differs from the section wrapper — the CTA's <a> button — while spacing and
 * alignment always come from the wrapper. `computedSeed` carries the LIVE
 * rendered colors from the preview iframe, used when the element has no inline
 * color of its own (inherited styles are invisible to the string guess).
 */
function guessDesignState(
  snippet: string,
  textSnippet = snippet,
  computedSeed?: { color?: string; background?: string },
) {
  const color = guessStyleValue(textSnippet, "color");
  const background = guessStyleValue(textSnippet, "background");
  const margin = guessStyleValue(snippet, "margin");
  const fontSizeRaw = guessStyleValue(textSnippet, "fontSize");
  const align = guessStyleValue(snippet, "textAlign");
  const weight = guessStyleValue(textSnippet, "fontWeight");

  const marginNums = margin ? margin.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [] : [];
  const maxMargin = marginNums.length ? Math.max(...marginNums) : 20;
  const spacing: SpacingPreset = maxMargin <= 12 ? "compact" : maxMargin >= 30 ? "roomy" : "normal";

  return {
    color:
      (color?.startsWith("#") ? color.slice(0, 7) : undefined) ??
      rgbToHex(computedSeed?.color) ??
      "#000000",
    background:
      (background?.startsWith("#") ? background.slice(0, 7) : undefined) ??
      rgbToHex(computedSeed?.background) ??
      "#ffffff",
    spacing,
    fontSize: fontSizeRaw ? parseInt(fontSizeRaw, 10) || 16 : 16,
    align: (align === "center" || align === "right" ? align : "left") as Alignment,
    bold: weight === "bold" || (weight ? parseInt(weight, 10) >= 600 : false),
  };
}

interface DesignPopoverProps {
  /** The section's current outerHTML, for seeding the controls. */
  snippet: string;
  /** The inner element carrying the text styling, when it isn't the wrapper (the CTA's <a>). */
  textSnippet?: string;
  /**
   * Which layout to render: "button" adds the wording field and relabels the
   * color controls; "header" strips the panel down to logo alignment only
   * (that is the one edit a logo needs); undefined is the full style panel.
   */
  variant?: "button" | "header";
  /** The section's live rendered colors (from the preview iframe), seeding the swatches when no inline color exists. */
  computedSeed?: { color?: string; background?: string };
  /** The button's current label, seeding the text field. */
  initialText?: string;
  /**
   * Saves new button wording (buttons never use contentEditable — typing on
   * the wrapper could delete the <a> itself). Rendering the field is gated on
   * this being present.
   */
  onApplyText?: (text: string) => void;
  /** Where to anchor, in VIEWPORT coordinates (the panel is portalled to body). */
  anchor: { top: number; left: number };
  /** Hard cap so a tall panel scrolls instead of running off the bottom of the screen. */
  maxHeight?: number;
  busy: boolean;
  onApply: (changes: StyleChanges) => void;
  onClose: () => void;
}

export function DesignPopover({
  snippet,
  textSnippet,
  variant,
  computedSeed,
  initialText,
  onApplyText,
  anchor,
  maxHeight,
  busy,
  onApply,
  onClose,
}: DesignPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const buttonMode = variant === "button";
  const headerMode = variant === "header";
  const initial = guessDesignState(snippet, textSnippet, computedSeed);
  const [text, setText] = useState(initialText ?? "");
  const textDirty = text.trim() !== (initialText ?? "").trim();
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

  // Portalled to <body> and positioned in VIEWPORT coordinates. The preview
  // container clips its overflow, so a panel rendered inside it had to flip up
  // and cover the very section being styled, which defeats the point of watching
  // the change land. Out here it can simply hang below the section, over the rest
  // of the page, like a normal inspector popover.
  return createPortal(
    <div
      ref={ref}
      style={{ top: anchor.top, left: anchor.left, maxHeight: maxHeight ?? undefined }}
      className="fixed z-50 w-[268px] space-y-3 overflow-y-auto rounded-xl border border-border bg-surface-2/95 p-3 shadow-2xl backdrop-blur"
    >
      {onApplyText && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted">Button text</p>
          <div className="flex items-center gap-1.5">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && text.trim() && textDirty && !busy) {
                  onApplyText(text.trim());
                }
              }}
              disabled={busy}
              placeholder="e.g. Book a call"
              className="h-7 flex-1 text-[12px]"
            />
            <Button
              variant="gradient"
              size="sm"
              disabled={busy || !text.trim() || !textDirty}
              onClick={() => onApplyText(text.trim())}
            >
              Apply
            </Button>
          </div>
        </div>
      )}

      {!headerMode && (
        <>
          <ColorRow
            label={buttonMode ? "Text color" : "Text"}
            value={color}
            onChange={setColor}
            onApply={() => onApply({ color })}
            busy={busy}
          />
          <ColorRow
            label={buttonMode ? "Button color" : "Background"}
            value={background}
            onChange={setBackground}
            onApply={() => onApply({ background })}
            busy={busy}
          />

          <div>
            <p className="mb-1 text-[11px] font-medium text-muted">Spacing</p>
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
        </>
      )}

      <div>
        <p className="mb-1 text-[11px] font-medium text-muted">
          {headerMode ? "Logo position" : "Alignment"}
        </p>
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

      {/* Size and weight share a row: both are single-tap controls. */}
      {!headerMode && (
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted">Size</p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy || fontSize <= 10}
              onClick={() => {
                const next = Math.max(10, fontSize - 2);
                setFontSize(next);
                onApply({ fontSize: `${next}px` });
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-3 text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
              aria-label="Decrease font size"
            >
              −
            </button>
            <span className="w-10 text-center text-[12.5px] tabular-nums text-foreground">
              {fontSize}px
            </span>
            <button
              type="button"
              disabled={busy || fontSize >= 64}
              onClick={() => {
                const next = Math.min(64, fontSize + 2);
                setFontSize(next);
                onApply({ fontSize: `${next}px` });
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-3 text-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
              aria-label="Increase font size"
            >
              +
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium text-muted">Weight</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const next = !bold;
              setBold(next);
              onApply({ fontWeight: next ? "700" : "400" });
            }}
            aria-pressed={bold}
            className={`h-7 rounded-full border px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-40 ${
              bold
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface-3 text-foreground hover:bg-surface-2"
            }`}
          >
            Bold
          </button>
        </div>
      </div>
      )}
    </div>,
    document.body,
  );
}

/** One colour control: swatch, hex field, Apply. Used for text and background. */
function ColorRow({
  label,
  value,
  onChange,
  onApply,
  busy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-muted">{label}</p>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          aria-label={`Pick a ${label.toLowerCase()} color`}
          className="h-7 w-7 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:opacity-50"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          className="h-7 flex-1 text-[12px]"
        />
        <Button variant="gradient" size="sm" disabled={busy} onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}
