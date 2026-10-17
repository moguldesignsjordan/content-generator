"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ChatQuestion, QuestionAnswer } from "@/lib/create-questions";
import { LookPicker } from "./look-picker";

/** An answer chip in the thread: lifts toward the brand light on hover. */
export const CHIP_CLASS =
  "rounded-full border border-border bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-foreground transition-[border-color,box-shadow,transform] duration-200 hover:border-accent/45 hover:shadow-[0_0_24px_-12px_rgba(255,61,140,0.5)] active:scale-[0.97] disabled:opacity-50";

/** One tappable answer, styled like the agent's chips. */
export function StepChip({
  label,
  onClick,
  disabled,
  primary,
  pressed,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** Set for multi-select chips. */
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50",
        primary
          ? "border-accent bg-accent text-white hover:bg-accent-press"
          : pressed
            ? "border-accent/40 bg-accent/[0.12] text-foreground"
            : CHIP_CLASS,
      )}
    >
      {label}
    </button>
  );
}

/** What a look picked in the style question says in the thread. */
export function lookMessage(lookId: string | null, styleImages: { from: "upload" | "competitor" } | null): string {
  if (lookId === null || lookId === "our") return "Use our style.";
  if (lookId === "none") return "No reference, you pick the style.";
  if (lookId === "ads") return "Follow the ads I picked, in our colors.";
  if (lookId === "images") {
    return styleImages?.from === "competitor" ? "Follow their ads' look, in our colors." : "Follow my designs.";
  }
  return "I picked a saved look to follow.";
}

/**
 * The tap answers for the agent's question, right under its message: one tap
 * sends a single-choice answer, several-choice ones send on Done. The style
 * question adds a chip that opens the look picker; style and photos point at
 * the paperclip. Typing in the composer answers it too.
 */
export function QuestionCard({
  question: q,
  disabled,
  lookId,
  onLookChange,
  styleImages,
  adPicks,
  onAdPicks,
  onSend,
}: {
  question: ChatQuestion;
  disabled: boolean;
  lookId: string | null;
  onLookChange: (value: string | null) => void;
  styleImages: { urls: string[]; from: "upload" | "competitor" } | null;
  adPicks: string[];
  onAdPicks: (ids: string[]) => void;
  onSend: (text: string, answers: QuestionAnswer[], lookChoice?: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [looksOpen, setLooksOpen] = useState(false);

  function tap(value: string, label: string) {
    if (!q.multi) {
      onSend(label, [{ id: q.id, values: [value] }]);
      return;
    }
    setPicked((now) => (now.includes(value) ? now.filter((v) => v !== value) : [...now, value]));
  }

  const pickedLabels = picked.map((v) => q.choices.find((c) => c.value === v)?.label ?? v);

  return (
    <div className="bubble-in space-y-2.5 sm:pl-9">
      {q.id === "style" && (
        <p className="text-xs text-muted">Or tap the paperclip to add a screenshot of one you like.</p>
      )}
      {q.id === "photos" && (
        <p className="text-xs text-muted">Tap the paperclip below to add them.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {q.choices.map((c) => (
          <StepChip
            key={c.value}
            label={c.label}
            pressed={q.multi ? picked.includes(c.value) : undefined}
            onClick={() => tap(c.value, c.label)}
            disabled={disabled}
          />
        ))}
        {q.id === "style" && (
          <StepChip
            label="My saved looks"
            pressed={looksOpen}
            onClick={() => setLooksOpen((open) => !open)}
            disabled={disabled}
          />
        )}
        {q.multi && (
          <StepChip
            primary
            label="Done"
            disabled={disabled || !picked.length}
            onClick={() => onSend(pickedLabels.join(", "), [{ id: q.id, values: picked }])}
          />
        )}
      </div>
      {looksOpen && (
        <div className="space-y-3 rounded-[22px] border border-border bg-surface-2 p-3.5">
          <LookPicker
            value={lookId}
            onChange={onLookChange}
            styleImages={styleImages}
            adPicks={adPicks}
            onAdPicks={onAdPicks}
          />
          <StepChip
            primary
            label="Use this"
            disabled={disabled}
            onClick={() => onSend(lookMessage(lookId, styleImages), [], lookId ?? "our")}
          />
        </div>
      )}
    </div>
  );
}
